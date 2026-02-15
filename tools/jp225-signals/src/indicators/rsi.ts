/**
 * Relative Strength Index (RSI)
 * Uses Wilder's smoothing (exponential, factor = 1/period)
 */
export function rsi(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) {
    return [];
  }

  const result: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Initial average from first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));

  // Subsequent values with Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      result.push(100 - 100 / (1 + avgGain / avgLoss));
    }
  }

  return result;
}

/** Get latest RSI value */
export function rsiLatest(closes: number[], period: number = 14): number | null {
  const values = rsi(closes, period);
  return values.length > 0 ? values[values.length - 1] : null;
}

/** Check if RSI crossed above a level (comparing last two values) */
export function rsiCrossedAbove(closes: number[], level: number, period: number = 14): boolean {
  const values = rsi(closes, period);
  if (values.length < 2) {
    return false;
  }
  return values[values.length - 2] <= level && values[values.length - 1] > level;
}

/** Check if RSI crossed below a level */
export function rsiCrossedBelow(closes: number[], level: number, period: number = 14): boolean {
  const values = rsi(closes, period);
  if (values.length < 2) {
    return false;
  }
  return values[values.length - 2] >= level && values[values.length - 1] < level;
}
