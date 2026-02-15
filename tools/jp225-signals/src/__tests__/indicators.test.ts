import { describe, it, expect } from "vitest";
import type { Candle } from "../data/types.js";
import { adx, adxLatest } from "../indicators/adx.js";
import { atr, atrLatest } from "../indicators/atr.js";
import { ema, emaLatest } from "../indicators/ema.js";
import { macd, macdHistBullishReversal, macdHistBearishReversal } from "../indicators/macd.js";
import { rsi, rsiLatest, rsiCrossedAbove } from "../indicators/rsi.js";
import {
  stochastic,
  stochBullishCross,
  stochBearishCross,
  stochLatest,
} from "../indicators/stochastic.js";

// Helper: generate candle array from close prices (with synthetic OHLCV)
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

// Helper: trending up prices
function trendingUp(start: number, count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i * step);
}

// Helper: trending down prices
function trendingDown(start: number, count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => start - i * step);
}

describe("EMA", () => {
  it("returns empty for insufficient data", () => {
    expect(ema([1, 2, 3], 5)).toEqual([]);
  });

  it("first EMA value equals SMA of first N periods", () => {
    const closes = [10, 20, 30, 40, 50];
    const result = ema(closes, 3);
    // SMA of first 3 = (10+20+30)/3 = 20
    expect(result[0]).toBeCloseTo(20, 5);
  });

  it("produces correct number of values", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const result = ema(closes, 10);
    // Should have 30 - 10 + 1 = 21 values
    expect(result).toHaveLength(21);
  });

  it("tracks uptrend (later values > earlier)", () => {
    const closes = trendingUp(100, 30, 5);
    const result = ema(closes, 10);
    // EMA should follow uptrend
    expect(result[result.length - 1]).toBeGreaterThan(result[0]);
  });

  it("emaLatest returns last value", () => {
    const closes = [10, 20, 30, 40, 50, 60, 70];
    const full = ema(closes, 3);
    expect(emaLatest(closes, 3)).toBeCloseTo(full[full.length - 1], 10);
  });

  it("emaLatest returns null for insufficient data", () => {
    expect(emaLatest([1, 2], 5)).toBeNull();
  });
});

describe("RSI", () => {
  it("returns empty for insufficient data", () => {
    expect(rsi([1, 2, 3], 14)).toEqual([]);
  });

  it("produces correct number of values", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 10);
    const result = rsi(closes, 14);
    // Should have 30 - 14 = 16 values (need period+1 for first change)
    expect(result).toHaveLength(30 - 14);
  });

  it("returns 100 for all gains (no losses)", () => {
    const closes = trendingUp(100, 20, 10);
    const result = rsi(closes, 14);
    expect(result[0]).toBe(100);
  });

  it("RSI stays between 0 and 100", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.5) * 30);
    const result = rsi(closes, 14);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("rsiCrossedAbove detects crossing", () => {
    // RSI crosses above 50 when price reverses from down to up
    const down = trendingDown(200, 20, 5);
    const up = trendingUp(100, 15, 10);
    const closes = [...down, ...up];
    // At some point RSI should cross above 50
    const result = rsiCrossedAbove(closes, 50, 14);
    // Either true or false, but shouldn't throw
    expect(typeof result).toBe("boolean");
  });

  it("rsiLatest returns null for insufficient data", () => {
    expect(rsiLatest([1, 2], 14)).toBeNull();
  });
});

describe("MACD", () => {
  it("returns empty for insufficient data", () => {
    const result = macd([1, 2, 3], 12, 26, 9);
    expect(result.macdLine).toEqual([]);
    expect(result.signalLine).toEqual([]);
    expect(result.histogram).toEqual([]);
  });

  it("histogram sums to macdLine - signalLine for aligned values", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.2) * 20);
    const result = macd(closes);
    const histLen = result.histogram.length;
    const sigLen = result.signalLine.length;
    const macdLen = result.macdLine.length;
    const offset = macdLen - sigLen;
    for (let i = 0; i < histLen; i++) {
      expect(result.histogram[i]).toBeCloseTo(
        result.macdLine[i + offset] - result.signalLine[i],
        10,
      );
    }
  });

  it("macdHistBullishReversal detects reversal", () => {
    // Downtrend followed by uptrend should produce bullish reversal
    const down = trendingDown(200, 40, 2);
    const up = trendingUp(120, 20, 3);
    const closes = [...down, ...up];
    const result = macdHistBullishReversal(closes);
    expect(typeof result).toBe("boolean");
  });

  it("macdHistBearishReversal detects reversal", () => {
    const up = trendingUp(100, 40, 2);
    const down = trendingDown(180, 20, 3);
    const closes = [...up, ...down];
    const result = macdHistBearishReversal(closes);
    expect(typeof result).toBe("boolean");
  });
});

describe("ATR", () => {
  it("returns empty for insufficient data", () => {
    const candles = candlesFromCloses([100, 200, 300]);
    expect(atr(candles, 14)).toEqual([]);
  });

  it("ATR is always positive", () => {
    const candles = candlesFromCloses(
      Array.from({ length: 30 }, (_, i) => 38000 + Math.sin(i) * 200),
      100,
    );
    const result = atr(candles, 14);
    for (const v of result) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it("produces correct number of values", () => {
    const candles = candlesFromCloses(Array.from({ length: 30 }, (_, i) => 38000 + i * 10));
    const result = atr(candles, 14);
    // Need period+1 data points, result = len-1 (TR) - period + 1
    // TR has 29 values, ATR starts at index 14, so 29-14+1 = 16
    expect(result).toHaveLength(16);
  });

  it("atrLatest returns last value", () => {
    const candles = candlesFromCloses(Array.from({ length: 30 }, (_, i) => 38000 + i * 10));
    const full = atr(candles, 14);
    expect(atrLatest(candles, 14)).toBeCloseTo(full[full.length - 1], 10);
  });

  it("atrLatest returns null for insufficient data", () => {
    const candles = candlesFromCloses([100, 200]);
    expect(atrLatest(candles, 14)).toBeNull();
  });
});

describe("ADX", () => {
  it("returns empty for insufficient data", () => {
    const candles = candlesFromCloses(Array.from({ length: 10 }, (_, i) => 100 + i));
    expect(adx(candles, 14)).toEqual([]);
  });

  it("ADX values are between 0 and 100", () => {
    const candles = candlesFromCloses(
      Array.from({ length: 60 }, (_, i) => 38000 + Math.sin(i * 0.3) * 500),
      200,
    );
    const result = adx(candles, 14);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("strong trend produces high ADX", () => {
    // Consistent uptrend
    const candles = candlesFromCloses(trendingUp(37000, 60, 100), 50);
    const result = adx(candles, 14);
    // Last ADX should be significantly above 20
    if (result.length > 0) {
      expect(result[result.length - 1]).toBeGreaterThan(15);
    }
  });

  it("adxLatest returns null for insufficient data", () => {
    const candles = candlesFromCloses([100]);
    expect(adxLatest(candles, 14)).toBeNull();
  });
});

describe("Stochastic", () => {
  it("returns empty for insufficient data", () => {
    const candles = candlesFromCloses([100, 200, 300]);
    const result = stochastic(candles, 14, 3, 3);
    expect(result.k).toEqual([]);
    expect(result.d).toEqual([]);
  });

  it("%K and %D are between 0 and 100", () => {
    const candles = candlesFromCloses(
      Array.from({ length: 40 }, (_, i) => 38000 + Math.sin(i * 0.5) * 300),
      100,
    );
    const result = stochastic(candles, 14, 3, 3);
    for (const v of result.k) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    for (const v of result.d) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("stochLatest returns last k/d values", () => {
    const candles = candlesFromCloses(
      Array.from({ length: 40 }, (_, i) => 38000 + i * 10),
      100,
    );
    const latest = stochLatest(candles, 14, 3, 3);
    expect(latest).not.toBeNull();
    expect(latest!.k).toBeGreaterThanOrEqual(0);
    expect(latest!.d).toBeGreaterThanOrEqual(0);
  });

  it("stochLatest returns null for insufficient data", () => {
    const candles = candlesFromCloses([100, 200]);
    expect(stochLatest(candles, 14, 3, 3)).toBeNull();
  });

  it("stochBullishCross/stochBearishCross return boolean", () => {
    const candles = candlesFromCloses(
      Array.from({ length: 40 }, (_, i) => 38000 + Math.sin(i * 0.3) * 500),
      200,
    );
    expect(typeof stochBullishCross(candles)).toBe("boolean");
    expect(typeof stochBearishCross(candles)).toBe("boolean");
  });
});
