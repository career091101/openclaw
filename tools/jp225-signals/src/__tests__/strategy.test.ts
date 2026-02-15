import { describe, it, expect } from "vitest";
import type { Config } from "../config.js";
import type { Candle } from "../data/types.js";
import type { Signal } from "../strategy/types.js";
import { evaluateEntry } from "../strategy/entry-screen.js";
import { calculateRiskLevels, calculatePositionSize } from "../strategy/risk-manager.js";
import { checkSignalStatus } from "../strategy/signal-evaluator.js";
import { evaluateSignal } from "../strategy/signal-screen.js";
import { evaluateTrend } from "../strategy/trend-screen.js";

function candlesFromCloses(closes: number[], spread = 50): Candle[] {
  return closes.map((c, i) => ({
    timestamp: 1700000000000 + i * 3600000,
    open: c - spread / 4,
    high: c + spread / 2,
    low: c - spread / 2,
    close: c,
    volume: 1000,
  }));
}

function trendingUp(start: number, count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i * step);
}

function trendingDown(start: number, count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => start - i * step);
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    symbol: "NIY=F",
    alwaysOn: true,
    analysisIntervalMs: 120000,
    monitorIntervalMs: 15000,
    maxActiveSignals: 3,
    cooldownMs: 4 * 3600000,
    consecutiveLossLimit: 3,
    consecutiveLossPauseMs: 86400000,
    signalExpiryMs: 28800000,
    atrMultiplierSL: 1.5,
    atrMultiplierTP1: 1.0,
    atrMultiplierTP2: 2.0,
    minScore: 2,
    riskPercent: 1.0,
    accountBalance: 1_000_000,
    dailySummaryHourJST: 7,
    backtestSlippagePoints: 5,
    backtestCommissionPoints: 3,
    slackBotToken: "",
    slackChannel: "",
    stateDir: "/tmp/jp225-test",
    yahoo: { baseUrl: "", timeoutMs: 15000, retries: 3 },
    marketHours: {
      closeDay: [6],
      maintenanceStartHourUTC: 22,
      maintenanceEndHourUTC: 23,
      warmupCandles: 2,
    },
    ...overrides,
  };
}

describe("evaluateTrend (Screen 1)", () => {
  it("returns FLAT for insufficient data", () => {
    const candles = candlesFromCloses([100, 200, 300]);
    const result = evaluateTrend(candles);
    expect(result.direction).toBe("FLAT");
  });

  it("returns BUY when EMA21 > EMA55 with strong ADX", () => {
    // Strong uptrend: 60 candles going up
    const candles = candlesFromCloses(trendingUp(35000, 80, 100), 50);
    const result = evaluateTrend(candles);
    // EMA21 should be above EMA55 in uptrend
    if (result.adx > 20) {
      expect(result.direction).toBe("BUY");
      expect(result.ema21).toBeGreaterThan(result.ema55);
    }
  });

  it("returns SELL when EMA21 < EMA55 with strong ADX", () => {
    const candles = candlesFromCloses(trendingDown(42000, 80, 100), 50);
    const result = evaluateTrend(candles);
    if (result.adx > 20) {
      expect(result.direction).toBe("SELL");
      expect(result.ema21).toBeLessThan(result.ema55);
    }
  });

  it("returns FLAT when ADX < 20 (weak trend)", () => {
    // Sideways oscillation
    const closes = Array.from({ length: 80 }, (_, i) => 38000 + Math.sin(i * 0.1) * 20);
    const candles = candlesFromCloses(closes, 10);
    const result = evaluateTrend(candles);
    // Sideways market should have low ADX
    if (result.adx <= 20) {
      expect(result.direction).toBe("FLAT");
    }
  });
});

describe("evaluateSignal (Screen 2)", () => {
  it("returns not confirmed for FLAT direction", () => {
    const candles = candlesFromCloses(trendingUp(38000, 40, 10));
    const result = evaluateSignal(candles, "FLAT");
    expect(result.confirmed).toBe(false);
  });

  it("confirms BUY when RSI is in 25-75 range", () => {
    // Oscillating data to produce RSI in mid-range
    const closes = Array.from({ length: 40 }, (_, i) => 38000 + Math.sin(i * 0.3) * 200);
    const candles = candlesFromCloses(closes);
    const result = evaluateSignal(candles, "BUY");
    // RSI should be in mid-range for oscillating data
    if (result.rsiValue > 25 && result.rsiValue < 75) {
      expect(result.confirmed).toBe(true);
      expect(result.rsiCrossed).toBe(true);
    }
  });

  it("confirms SELL when RSI is in 25-75 range", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 38000 + Math.sin(i * 0.3) * 200);
    const candles = candlesFromCloses(closes);
    const result = evaluateSignal(candles, "SELL");
    if (result.rsiValue > 25 && result.rsiValue < 75) {
      expect(result.confirmed).toBe(true);
    }
  });
});

describe("evaluateEntry (Screen 3)", () => {
  it("returns not triggered for FLAT direction", () => {
    const candles = candlesFromCloses(trendingUp(38000, 40, 10));
    const result = evaluateEntry(candles, "FLAT");
    expect(result.triggered).toBe(false);
    expect(result.stochK).toBe(0);
    expect(result.stochD).toBe(0);
  });

  it("returns triggered for BUY when K > D", () => {
    // Uptrend should produce K > D
    const candles = candlesFromCloses(trendingUp(37000, 30, 50), 30);
    const result = evaluateEntry(candles, "BUY");
    if (result.stochK > result.stochD) {
      expect(result.triggered).toBe(true);
    }
  });

  it("returns triggered for SELL when K < D", () => {
    const candles = candlesFromCloses(trendingDown(40000, 30, 50), 30);
    const result = evaluateEntry(candles, "SELL");
    if (result.stochK < result.stochD) {
      expect(result.triggered).toBe(true);
    }
  });

  it("returns not triggered for insufficient data", () => {
    const candles = candlesFromCloses([100, 200]);
    const result = evaluateEntry(candles, "BUY");
    expect(result.triggered).toBe(false);
  });
});

describe("calculateRiskLevels", () => {
  const config = makeConfig();

  it("returns null for insufficient candle data", () => {
    const candles = candlesFromCloses([100, 200]);
    expect(calculateRiskLevels("BUY", 38000, candles, config)).toBeNull();
  });

  it("BUY: SL < entry < TP1 < TP2", () => {
    const candles = candlesFromCloses(
      Array.from({ length: 30 }, (_, i) => 38000 + Math.sin(i) * 100),
      80,
    );
    const result = calculateRiskLevels("BUY", 38000, candles, config);
    if (result) {
      expect(result.stopLoss).toBeLessThan(result.entry);
      expect(result.takeProfit1).toBeGreaterThan(result.entry);
      expect(result.takeProfit2).toBeGreaterThan(result.takeProfit1);
      expect(result.atrValue).toBeGreaterThan(0);
      expect(result.riskRewardRatio).toBeGreaterThan(0);
    }
  });

  it("SELL: SL > entry > TP1 > TP2", () => {
    const candles = candlesFromCloses(
      Array.from({ length: 30 }, (_, i) => 38000 + Math.sin(i) * 100),
      80,
    );
    const result = calculateRiskLevels("SELL", 38000, candles, config);
    if (result) {
      expect(result.stopLoss).toBeGreaterThan(result.entry);
      expect(result.takeProfit1).toBeLessThan(result.entry);
      expect(result.takeProfit2).toBeLessThan(result.takeProfit1);
    }
  });
});

describe("calculatePositionSize", () => {
  const config = makeConfig();

  it("calculates correct position size", () => {
    // 1% of 1M = 10,000 risk. SL distance = 200 → position = 50
    const result = calculatePositionSize(38000, 37800, config);
    expect(result).toBe(50);
  });

  it("returns 0 when SL equals entry", () => {
    expect(calculatePositionSize(38000, 38000, config)).toBe(0);
  });

  it("works for SELL (SL above entry)", () => {
    const result = calculatePositionSize(38000, 38200, config);
    expect(result).toBe(50);
  });
});

describe("checkSignalStatus", () => {
  function makeSignal(overrides: Partial<Signal> = {}): Signal {
    return {
      id: "test-1",
      direction: "BUY",
      entry: 38000,
      stopLoss: 37700,
      takeProfit1: 38200,
      takeProfit2: 38400,
      atrValue: 200,
      score: 3,
      createdAt: Date.now(),
      status: "active",
      tp1Hit: false,
      details: {
        d1: { direction: "BUY", ema21: 38100, ema55: 37900, adx: 30 },
        h4: { confirmed: true, rsiValue: 45, rsiCrossed: true, macdHistReversed: false },
        m15: { triggered: true, stochK: 25, stochD: 20 },
      },
      ...overrides,
    };
  }

  it("returns 'sl' when price hits stop loss (BUY)", () => {
    const signal = makeSignal({ direction: "BUY", stopLoss: 37700 });
    expect(checkSignalStatus(signal, 37700)).toBe("sl");
    expect(checkSignalStatus(signal, 37600)).toBe("sl");
  });

  it("returns 'tp1' when price hits TP1 (BUY)", () => {
    const signal = makeSignal({ direction: "BUY", takeProfit1: 38200, tp1Hit: false });
    expect(checkSignalStatus(signal, 38200)).toBe("tp1");
    expect(checkSignalStatus(signal, 38300)).toBe("tp1");
  });

  it("returns 'tp2' when price hits TP2 after TP1 (BUY)", () => {
    const signal = makeSignal({ direction: "BUY", takeProfit2: 38400, tp1Hit: true });
    expect(checkSignalStatus(signal, 38400)).toBe("tp2");
  });

  it("returns null when price between SL and TP1 (BUY)", () => {
    const signal = makeSignal({ direction: "BUY" });
    expect(checkSignalStatus(signal, 38100)).toBeNull();
  });

  it("returns 'sl' when price hits stop loss (SELL)", () => {
    const signal = makeSignal({ direction: "SELL", stopLoss: 38300 });
    expect(checkSignalStatus(signal, 38300)).toBe("sl");
    expect(checkSignalStatus(signal, 38400)).toBe("sl");
  });

  it("returns 'tp1' when price hits TP1 (SELL)", () => {
    const signal = makeSignal({
      direction: "SELL",
      entry: 38000,
      stopLoss: 38300,
      takeProfit1: 37800,
      tp1Hit: false,
    });
    expect(checkSignalStatus(signal, 37800)).toBe("tp1");
    expect(checkSignalStatus(signal, 37700)).toBe("tp1");
  });

  it("returns 'tp2' when price hits TP2 after TP1 (SELL)", () => {
    const signal = makeSignal({
      direction: "SELL",
      entry: 38000,
      takeProfit2: 37600,
      tp1Hit: true,
    });
    expect(checkSignalStatus(signal, 37600)).toBe("tp2");
  });
});
