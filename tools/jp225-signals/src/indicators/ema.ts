/**
 * Exponential Moving Average (EMA)
 * EMA = close × k + prevEMA × (1 - k), where k = 2 / (period + 1)
 */
export function ema(closes: number[], period: number): number[] {
  if (closes.length < period) {
    return [];
  }

  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  let prev = sum / period;
  result.push(prev);

  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    result.push(prev);
  }

  return result;
}

/** Get latest EMA value */
export function emaLatest(closes: number[], period: number): number | null {
  const values = ema(closes, period);
  return values.length > 0 ? values[values.length - 1] : null;
}
