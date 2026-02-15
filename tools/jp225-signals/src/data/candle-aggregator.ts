import type { Candle } from "./types.js";

/**
 * Aggregate 1H candles into 4H candles.
 * Groups by 4-hour blocks aligned to midnight UTC.
 */
export function aggregateToH4(h1Candles: Candle[]): Candle[] {
  if (h1Candles.length === 0) {
    return [];
  }

  const groups = new Map<number, Candle[]>();

  for (const candle of h1Candles) {
    // Align to 4-hour blocks from midnight UTC
    const date = new Date(candle.timestamp);
    const hourBlock = Math.floor(date.getUTCHours() / 4) * 4;
    date.setUTCHours(hourBlock, 0, 0, 0);
    const key = date.getTime();

    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(candle);
  }

  const result: Candle[] = [];
  const sortedKeys = Array.from(groups.keys()).toSorted((a: number, b: number) => a - b);

  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    // Include candles with at least 2 hourly bars (market open/close blocks may have fewer)
    if (group.length < 2) {
      continue;
    }

    result.push({
      timestamp: key,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return result;
}

/**
 * Check for consecutive missing candles in a series during active trading hours.
 * Weekend gaps (Fri→Sun) and daily maintenance windows are expected and ignored.
 * Returns true only if there is an unexpected gap during normal trading sessions.
 */
export function hasExcessiveGap(
  candles: Candle[],
  expectedIntervalMs: number,
  maxConsecutiveMissing: number = 2,
): boolean {
  for (let i = 1; i < candles.length; i++) {
    const gap = candles[i].timestamp - candles[i - 1].timestamp;
    const missedCandles = Math.round(gap / expectedIntervalMs) - 1;
    if (missedCandles < maxConsecutiveMissing) {
      continue;
    }

    // Allow weekend gaps (Friday close → Sunday open, up to ~48h)
    const prev = new Date(candles[i - 1].timestamp);
    const curr = new Date(candles[i].timestamp);
    const prevDay = prev.getUTCDay();
    if (prevDay === 5 || prevDay === 6) {
      continue;
    } // Fri/Sat → expected gap

    // Allow daily maintenance window gap (up to 2h)
    if (gap <= 3 * 60 * 60 * 1000) {
      continue;
    }

    return true;
  }
  return false;
}
