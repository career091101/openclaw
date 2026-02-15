import type { Candle } from "../data/types.js";
import type { TrendResult, TrendDirection } from "./types.js";
import { adxLatest } from "../indicators/adx.js";
import { emaLatest } from "../indicators/ema.js";

/**
 * Screen 1: Daily trend determination
 * - EMA(21) vs EMA(55) for direction
 * - ADX(14) > 20 for trend validity
 */
export function evaluateTrend(d1Candles: Candle[]): TrendResult {
  const closes = d1Candles.map((c) => c.close);
  const ema21 = emaLatest(closes, 21);
  const ema55 = emaLatest(closes, 55);
  const adxValue = adxLatest(d1Candles, 14);

  if (ema21 === null || ema55 === null || adxValue === null) {
    return { direction: "FLAT", ema21: 0, ema55: 0, adx: 0 };
  }

  // ADX must be > 20 for valid trend
  if (adxValue <= 20) {
    return { direction: "FLAT", ema21, ema55, adx: adxValue };
  }

  const direction: TrendDirection = ema21 > ema55 ? "BUY" : "SELL";
  return { direction, ema21, ema55, adx: adxValue };
}
