import type { Config } from "../config.js";
import type { Candle, MultiTimeframeData } from "../data/types.js";
import type { Signal, DailyStats } from "../strategy/types.js";
import { aggregateToH4 } from "../data/candle-aggregator.js";
import { shouldSuppressSignal, isDuplicate } from "../state/duplicate-guard.js";
import { evaluate, checkSignalStatus } from "../strategy/signal-evaluator.js";

export interface BacktestResult {
  totalSignals: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  totalPnlPoints: number;
  netPnlPoints: number;
  totalSlippage: number;
  avgWinPoints: number;
  avgLossPoints: number;
  profitFactor: number;
  maxDrawdownPoints: number;
  maxConsecutiveLosses: number;
  signals: BacktestSignal[];
}

export interface BacktestSignal {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  score: number;
  outcome: "tp1_hit" | "tp2_hit" | "sl_hit" | "expired" | "tp1_then_expired" | "tp1_then_be";
  pnlPoints: number;
  slippagePoints: number;
  netPnlPoints: number;
  entryTime: number;
  exitTime: number;
  exitPrice: number;
}

/**
 * Run a backtest over historical candle data.
 * Simulates the Triple Screen strategy candle by candle on M15 timeframe.
 */
export function runBacktest(
  d1Candles: Candle[],
  h1Candles: Candle[],
  m15Candles: Candle[],
  config: Config,
): BacktestResult {
  const h4Candles = aggregateToH4(h1Candles);
  const signals: BacktestSignal[] = [];
  const activeSignals: Signal[] = [];
  let lastSignalAt = 0;
  let consecutiveLosses = 0;
  let lastLossAt = 0;

  // Warmup: minimum candles for indicators to produce valid output
  const D1_WARMUP = 56; // EMA(55) needs 55, +1 for safety
  const H4_WARMUP = 36; // MACD(26+9) needs 35
  const H1_WARMUP = 15; // ATR(14) needs 15
  const M15_WARMUP = 20; // Stochastic(14,3,3) needs ~20

  if (d1Candles.length < D1_WARMUP || h4Candles.length < H4_WARMUP) {
    return emptyResult();
  }

  // Iterate M15 candles as the simulation clock
  for (let i = M15_WARMUP; i < m15Candles.length; i++) {
    const now = m15Candles[i].timestamp;
    const currentPrice = m15Candles[i].close;

    // --- Monitor active signals for SL/TP/expiry ---
    for (let j = activeSignals.length - 1; j >= 0; j--) {
      const sig = activeSignals[j];
      const status = checkSignalStatus(sig, currentPrice);

      let outcome: BacktestSignal["outcome"] | null = null;
      let exitPrice = currentPrice;

      if (status === "sl") {
        if (sig.tp1Hit) {
          // After TP1, SL moved to breakeven — close remaining 50% at entry
          outcome = "tp1_then_be";
          exitPrice = sig.entry;
        } else {
          outcome = "sl_hit";
          exitPrice = sig.stopLoss;
        }
      } else if (status === "tp1" && !sig.tp1Hit) {
        sig.tp1Hit = true;
        // Move SL to breakeven after TP1 hit
        sig.stopLoss = sig.entry;
        continue;
      } else if (status === "tp2") {
        outcome = "tp2_hit";
        exitPrice = sig.takeProfit2;
      } else if (now - sig.createdAt > config.signalExpiryMs) {
        outcome = sig.tp1Hit ? "tp1_then_expired" : "expired";
      }

      if (outcome) {
        // P/L calculation: if TP1 was hit, blend 50% at TP1 + 50% at exit
        let pnl: number;
        const tp1Pnl =
          sig.direction === "BUY" ? sig.takeProfit1 - sig.entry : sig.entry - sig.takeProfit1;
        const exitPnl = sig.direction === "BUY" ? exitPrice - sig.entry : sig.entry - exitPrice;

        if (sig.tp1Hit) {
          pnl = (tp1Pnl + exitPnl) / 2; // Blended: 50% TP1 + 50% exit
        } else {
          pnl = exitPnl;
        }

        const slippage = config.backtestSlippagePoints * 2; // entry + exit
        const commission = config.backtestCommissionPoints;
        const netPnl = pnl - slippage - commission;

        signals.push({
          direction: sig.direction,
          entry: sig.entry,
          stopLoss: sig.stopLoss,
          takeProfit1: sig.takeProfit1,
          takeProfit2: sig.takeProfit2,
          score: sig.score,
          outcome,
          pnlPoints: pnl,
          slippagePoints: slippage,
          netPnlPoints: netPnl,
          entryTime: sig.createdAt,
          exitTime: now,
          exitPrice,
        });

        if (outcome === "sl_hit") {
          consecutiveLosses++;
          lastLossAt = now;
        } else if (
          outcome === "tp2_hit" ||
          outcome === "tp1_then_be" ||
          outcome === "tp1_then_expired"
        ) {
          consecutiveLosses = 0;
        }

        activeSignals.splice(j, 1);
      }
    }

    // --- Only analyze every 4th M15 bar (simulate ~1 analysis per hour to save CPU) ---
    if (i % 4 !== 0) {
      continue;
    }

    // Build MTF data snapshot up to current time
    const d1Slice = d1Candles.filter((c) => c.timestamp <= now);
    const h4Slice = h4Candles.filter((c) => c.timestamp <= now);
    const h1Slice = h1Candles.filter((c) => c.timestamp <= now);
    const m15Slice = m15Candles.slice(0, i + 1);

    if (d1Slice.length < D1_WARMUP || h4Slice.length < H4_WARMUP || h1Slice.length < H1_WARMUP) {
      continue;
    }

    const data: MultiTimeframeData = {
      d1: d1Slice,
      h4: h4Slice,
      h1: h1Slice,
      m15: m15Slice,
      currentPrice,
      fetchedAt: now,
    };

    const result = evaluate(data, config);
    if (!result.signal) {
      continue;
    }

    const signal = result.signal;
    signal.createdAt = now;

    // Duplicate / suppression checks
    if (isDuplicate(signal.direction, signal.entry, signal.atrValue, activeSignals)) {
      continue;
    }
    const suppression = shouldSuppressSignal(
      signal.direction,
      activeSignals,
      lastSignalAt,
      consecutiveLosses,
      config,
      lastLossAt,
    );
    if (suppression.suppressed) {
      continue;
    }

    activeSignals.push(signal);
    lastSignalAt = now;
  }

  // Close any remaining active signals as expired
  for (const sig of activeSignals) {
    const slippage = config.backtestSlippagePoints * 2;
    const commission = config.backtestCommissionPoints;
    signals.push({
      direction: sig.direction,
      entry: sig.entry,
      stopLoss: sig.stopLoss,
      takeProfit1: sig.takeProfit1,
      takeProfit2: sig.takeProfit2,
      score: sig.score,
      outcome: "expired",
      pnlPoints: 0,
      slippagePoints: slippage,
      netPnlPoints: -(slippage + commission),
      entryTime: sig.createdAt,
      exitTime: m15Candles[m15Candles.length - 1].timestamp,
      exitPrice: m15Candles[m15Candles.length - 1].close,
    });
  }

  return computeStats(signals);
}

function computeStats(signals: BacktestSignal[]): BacktestResult {
  const wins = signals.filter(
    (s) =>
      s.outcome === "tp1_hit" ||
      s.outcome === "tp2_hit" ||
      s.outcome === "tp1_then_expired" ||
      s.outcome === "tp1_then_be",
  );
  const losses = signals.filter((s) => s.outcome === "sl_hit");
  const expired = signals.filter((s) => s.outcome === "expired");

  const totalPnl = signals.reduce((sum, s) => sum + s.pnlPoints, 0);
  const totalNetPnl = signals.reduce((sum, s) => sum + s.netPnlPoints, 0);
  const totalSlippage = signals.reduce((sum, s) => sum + s.slippagePoints, 0);
  const grossWin = wins.reduce((sum, s) => sum + s.pnlPoints, 0);
  const grossLoss = Math.abs(losses.reduce((sum, s) => sum + s.pnlPoints, 0));

  // Max drawdown
  let peak = 0;
  let cumPnl = 0;
  let maxDrawdown = 0;
  for (const s of signals) {
    cumPnl += s.pnlPoints;
    if (cumPnl > peak) {
      peak = cumPnl;
    }
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  }

  // Max consecutive losses
  let maxConsecLoss = 0;
  let consecLoss = 0;
  for (const s of signals) {
    if (s.outcome === "sl_hit") {
      consecLoss++;
      maxConsecLoss = Math.max(maxConsecLoss, consecLoss);
    } else {
      consecLoss = 0;
    }
  }

  return {
    totalSignals: signals.length,
    wins: wins.length,
    losses: losses.length,
    expired: expired.length,
    winRate: signals.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0,
    totalPnlPoints: totalPnl,
    netPnlPoints: totalNetPnl,
    totalSlippage,
    avgWinPoints: wins.length > 0 ? grossWin / wins.length : 0,
    avgLossPoints: losses.length > 0 ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPoints: maxDrawdown,
    maxConsecutiveLosses: maxConsecLoss,
    signals,
  };
}

function emptyResult(): BacktestResult {
  return {
    totalSignals: 0,
    wins: 0,
    losses: 0,
    expired: 0,
    winRate: 0,
    totalPnlPoints: 0,
    netPnlPoints: 0,
    totalSlippage: 0,
    avgWinPoints: 0,
    avgLossPoints: 0,
    profitFactor: 0,
    maxDrawdownPoints: 0,
    maxConsecutiveLosses: 0,
    signals: [],
  };
}
