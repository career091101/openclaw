import type { Candle } from "../data/types.js";

export interface StochasticResult {
  k: number[];
  d: number[];
}

/**
 * Stochastic Oscillator
 * %K = (Close - Lowest Low) / (Highest High - Lowest Low) × 100
 * %D = SMA(%K, dPeriod)
 */
export function stochastic(
  candles: Candle[],
  kPeriod: number = 14,
  kSmooth: number = 3,
  dPeriod: number = 3,
): StochasticResult {
  if (candles.length < kPeriod) {
    return { k: [], d: [] };
  }

  // Raw %K
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let lowestLow = Infinity;
    let highestHigh = -Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].low < lowestLow) {
        lowestLow = candles[j].low;
      }
      if (candles[j].high > highestHigh) {
        highestHigh = candles[j].high;
      }
    }
    const range = highestHigh - lowestLow;
    rawK.push(range === 0 ? 50 : ((candles[i].close - lowestLow) / range) * 100);
  }

  // Smooth %K with SMA
  const k = sma(rawK, kSmooth);

  // %D = SMA of smoothed %K
  const d = sma(k, dPeriod);

  return { k, d };
}

function sma(values: number[], period: number): number[] {
  if (values.length < period) {
    return [];
  }
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result.push(sum / period);
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    result.push(sum / period);
  }
  return result;
}

/** Check if %K crossed above %D below a threshold (bullish) */
export function stochBullishCross(
  candles: Candle[],
  threshold: number = 20,
  kPeriod: number = 14,
  kSmooth: number = 3,
  dPeriod: number = 3,
): boolean {
  const { k, d } = stochastic(candles, kPeriod, kSmooth, dPeriod);
  if (k.length < 2 || d.length < 2) {
    return false;
  }
  const kLen = k.length;
  const dLen = d.length;
  const prevK = k[kLen - 2];
  const currK = k[kLen - 1];
  const prevD = d[dLen - 2];
  const currD = d[dLen - 1];
  return prevK <= prevD && currK > currD && currK <= threshold + 20;
}

/** Check if %K crossed below %D above a threshold (bearish) */
export function stochBearishCross(
  candles: Candle[],
  threshold: number = 80,
  kPeriod: number = 14,
  kSmooth: number = 3,
  dPeriod: number = 3,
): boolean {
  const { k, d } = stochastic(candles, kPeriod, kSmooth, dPeriod);
  if (k.length < 2 || d.length < 2) {
    return false;
  }
  const kLen = k.length;
  const prevK = k[kLen - 2];
  const currK = k[kLen - 1];
  const prevD = d[d.length - 2];
  const currD = d[d.length - 1];
  return prevK >= prevD && currK < currD && currK >= threshold - 20;
}

/** Get latest stochastic values */
export function stochLatest(
  candles: Candle[],
  kPeriod: number = 14,
  kSmooth: number = 3,
  dPeriod: number = 3,
): { k: number; d: number } | null {
  const result = stochastic(candles, kPeriod, kSmooth, dPeriod);
  if (result.k.length === 0 || result.d.length === 0) {
    return null;
  }
  return { k: result.k[result.k.length - 1], d: result.d[result.d.length - 1] };
}
