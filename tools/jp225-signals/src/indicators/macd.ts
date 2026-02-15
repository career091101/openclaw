import { ema } from "./ema.js";

export interface MACDResult {
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
}

/**
 * MACD (Moving Average Convergence Divergence)
 * MACD Line = EMA(fast) - EMA(slow)
 * Signal Line = EMA(MACD Line, signal)
 * Histogram = MACD Line - Signal Line
 */
export function macd(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): MACDResult {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);

  // Align: slowEma starts later, so offset fastEma
  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];
  for (let i = 0; i < slowEma.length; i++) {
    macdLine.push(fastEma[i + offset] - slowEma[i]);
  }

  const signalLine = ema(macdLine, signalPeriod);

  // Align histogram
  const histOffset = macdLine.length - signalLine.length;
  const histogram: number[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + histOffset] - signalLine[i]);
  }

  return { macdLine, signalLine, histogram };
}

/** Check if MACD histogram reversed from negative to positive (bullish) */
export function macdHistBullishReversal(closes: number[]): boolean {
  const { histogram } = macd(closes);
  if (histogram.length < 2) {
    return false;
  }
  return histogram[histogram.length - 2] <= 0 && histogram[histogram.length - 1] > 0;
}

/** Check if MACD histogram reversed from positive to negative (bearish) */
export function macdHistBearishReversal(closes: number[]): boolean {
  const { histogram } = macd(closes);
  if (histogram.length < 2) {
    return false;
  }
  return histogram[histogram.length - 2] >= 0 && histogram[histogram.length - 1] < 0;
}
