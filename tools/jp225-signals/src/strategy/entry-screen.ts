import type { Candle } from "../data/types.js";
import type { TrendDirection, EntryTrigger } from "./types.js";
import { stochLatest } from "../indicators/stochastic.js";

/**
 * Screen 3: M15 entry timing
 * BUY: %K > %D (upward momentum) AND not overbought (%K < 80)
 * SELL: %K < %D (downward momentum) AND not oversold (%K > 20)
 *
 * Rejects entries at extreme zones in the wrong direction to avoid
 * buying at tops and selling at bottoms.
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
    // %K above %D + reject overbought (K >= 80)
    triggered = latest.k > latest.d && latest.k < 80;
  } else {
    // %K below %D + reject oversold (K <= 20)
    triggered = latest.k < latest.d && latest.k > 20;
  }

  return { triggered, stochK: latest.k, stochD: latest.d };
}
