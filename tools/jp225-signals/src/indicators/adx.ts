import type { Candle } from "../data/types.js";

/**
 * Average Directional Index (ADX)
 * +DM = currHigh - prevHigh (if positive and > -DM, else 0)
 * -DM = prevLow - currLow (if positive and > +DM, else 0)
 * TR = max(high-low, |high-prevClose|, |low-prevClose|)
 * +DI = 100 × smoothed(+DM) / smoothed(TR)
 * -DI = 100 × smoothed(-DM) / smoothed(TR)
 * DX = 100 × |+DI - -DI| / (+DI + -DI)
 * ADX = smoothed(DX)
 */
export function adx(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period * 2 + 1) {
    return [];
  }

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const currHigh = candles[i].high;
    const currLow = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const upMove = currHigh - prevHigh;
    const downMove = prevLow - currLow;

    plusDM.push(upMove > 0 && upMove > downMove ? upMove : 0);
    minusDM.push(downMove > 0 && downMove > upMove ? downMove : 0);
    tr.push(
      Math.max(currHigh - currLow, Math.abs(currHigh - prevClose), Math.abs(currLow - prevClose)),
    );
  }

  // Wilder's smoothing for +DM, -DM, TR
  const smoothedPlusDM = wilderSmooth(plusDM, period);
  const smoothedMinusDM = wilderSmooth(minusDM, period);
  const smoothedTR = wilderSmooth(tr, period);

  // Calculate +DI, -DI, DX
  const dx: number[] = [];
  for (let i = 0; i < smoothedTR.length; i++) {
    const plusDI = smoothedTR[i] === 0 ? 0 : (100 * smoothedPlusDM[i]) / smoothedTR[i];
    const minusDI = smoothedTR[i] === 0 ? 0 : (100 * smoothedMinusDM[i]) / smoothedTR[i];
    const diSum = plusDI + minusDI;
    dx.push(diSum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / diSum);
  }

  // ADX = Wilder's smoothed DX
  return wilderSmooth(dx, period);
}

function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) {
    return [];
  }
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let current = sum / period;
  result.push(current);
  for (let i = period; i < values.length; i++) {
    current = (current * (period - 1) + values[i]) / period;
    result.push(current);
  }
  return result;
}

/** Get latest ADX value */
export function adxLatest(candles: Candle[], period: number = 14): number | null {
  const values = adx(candles, period);
  return values.length > 0 ? values[values.length - 1] : null;
}
