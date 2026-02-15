import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { Candle, MultiTimeframeData } from "../data/types.js";
import type { Signal } from "./types.js";
import { evaluateEntry } from "./entry-screen.js";
import { calculateRiskLevels, calculatePositionSize } from "./risk-manager.js";
import { evaluateSignal } from "./signal-screen.js";
import { evaluateTrend } from "./trend-screen.js";

export interface EvaluationResult {
  signal: Signal | null;
  reason: string;
}

/**
 * Integrate all three screens to produce a signal (or rejection reason).
 */
export function evaluate(data: MultiTimeframeData, config: Config): EvaluationResult {
  // Screen 1: D1 trend
  const trend = evaluateTrend(data.d1);
  if (trend.direction === "FLAT") {
    return { signal: null, reason: `Screen1 FLAT (ADX=${trend.adx.toFixed(1)})` };
  }

  // Screen 2: H4 confirmation
  const confirmation = evaluateSignal(data.h4, trend.direction);
  if (!confirmation.confirmed) {
    const parts: string[] = [];
    if (!confirmation.rsiCrossed) {
      parts.push("RSI not crossed");
    }
    if (!confirmation.macdHistReversed) {
      parts.push("MACD hist not reversed");
    }
    return { signal: null, reason: `Screen2 not confirmed: ${parts.join(", ")}` };
  }

  // Screen 3: M15 entry
  const entry = evaluateEntry(data.m15, trend.direction);
  if (!entry.triggered) {
    return { signal: null, reason: `Screen3 not triggered (Stoch K=${entry.stochK.toFixed(1)})` };
  }

  // Risk levels
  const risk = calculateRiskLevels(trend.direction, data.currentPrice, data.h1, config);
  if (!risk) {
    return { signal: null, reason: "Cannot calculate ATR for risk levels" };
  }

  // Score: signal quality (1-5 scale)
  let score = 1; // Base: all 3 screens passed
  if (trend.adx > 30) {
    score++;
  } // Strong trend
  if (trend.adx > 40) {
    score++;
  } // Very strong trend
  if (confirmation.rsiCrossed && confirmation.macdHistReversed) {
    score++;
  } // Both confirmations
  // Stochastic in extreme zone = higher conviction
  const stochExtreme =
    trend.direction === "BUY"
      ? entry.stochK < 30 // Oversold on entry
      : entry.stochK > 70; // Overbought on entry
  if (stochExtreme) {
    score++;
  }

  // Minimum score filter
  if (score < config.minScore) {
    return { signal: null, reason: `Score too low (${score}/${config.minScore} required)` };
  }

  const signal: Signal = {
    id: randomUUID().slice(0, 8),
    direction: trend.direction,
    entry: Math.round(data.currentPrice),
    stopLoss: risk.stopLoss,
    takeProfit1: risk.takeProfit1,
    takeProfit2: risk.takeProfit2,
    atrValue: risk.atrValue,
    score,
    createdAt: Date.now(),
    status: "active",
    tp1Hit: false,
    details: {
      d1: trend,
      h4: confirmation,
      m15: entry,
    },
  };

  signal.positionSize = calculatePositionSize(signal.entry, signal.stopLoss, config);

  return { signal, reason: "All screens passed" };
}

/**
 * Check if an active signal has hit SL, TP1, or TP2.
 */
export function checkSignalStatus(
  signal: Signal,
  currentPrice: number,
): "tp1" | "tp2" | "sl" | "expired" | null {
  const now = Date.now();

  if (signal.direction === "BUY") {
    if (currentPrice <= signal.stopLoss) {
      return "sl";
    }
    if (!signal.tp1Hit && currentPrice >= signal.takeProfit1) {
      return "tp1";
    }
    if (signal.tp1Hit && currentPrice >= signal.takeProfit2) {
      return "tp2";
    }
  } else {
    if (currentPrice >= signal.stopLoss) {
      return "sl";
    }
    if (!signal.tp1Hit && currentPrice <= signal.takeProfit1) {
      return "tp1";
    }
    if (signal.tp1Hit && currentPrice <= signal.takeProfit2) {
      return "tp2";
    }
  }

  return null;
}
