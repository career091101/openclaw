import type { Candle } from "../data/types.js";

/**
 * Average True Range (ATR)
 * TR = max(high-low, |high-prevClose|, |low-prevClose|)
 * ATR = Wilder's smoothed average of TR
 */
export function atr(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period + 1) {
    return [];
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  const result: number[] = [];

  // Initial ATR = simple average of first `period` TRs
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += trueRanges[i];
  }
  let current = sum / period;
  result.push(current);

  // Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    current = (current * (period - 1) + trueRanges[i]) / period;
    result.push(current);
  }

  return result;
}

/** Get latest ATR value */
export function atrLatest(candles: Candle[], period: number = 14): number | null {
  const values = atr(candles, period);
  return values.length > 0 ? values[values.length - 1] : null;
}
