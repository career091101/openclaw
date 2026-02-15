import type { Candle } from "../data/types.js";
import type { TrendDirection, EntryTrigger } from "./types.js";
import { stochBullishCross, stochBearishCross, stochLatest } from "../indicators/stochastic.js";

/**
 * Screen 3: M15 entry timing (relaxed)
 * BUY: %K > %D (upward momentum) — no threshold requirement
 * SELL: %K < %D (downward momentum) — no threshold requirement
 */
export function evaluateEntry(m15Candles: Candle[], direction: TrendDirection): EntryTrigger {
  if (direction === "FLAT") {
    return { triggered: false, stochK: 0, stochD: 0 };
  }

  const latest = stochLatest(m15Candles, 14, 3, 3);
  if (!latest) {
    return { triggered: false, stochK: 0, stochD: 0 };
  }

  let triggered: boolean;
  if (direction === "BUY") {
    // Relaxed: %K above %D indicates upward momentum
    triggered = latest.k > latest.d;
  } else {
    // Relaxed: %K below %D indicates downward momentum
    triggered = latest.k < latest.d;
  }

  return { triggered, stochK: latest.k, stochD: latest.d };
}
