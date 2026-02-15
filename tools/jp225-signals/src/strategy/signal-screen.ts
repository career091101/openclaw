import type { Candle } from "../data/types.js";
import type { TrendDirection, SignalConfirmation } from "./types.js";
import { macdHistBullishReversal, macdHistBearishReversal } from "../indicators/macd.js";
import { rsi, rsiCrossedAbove, rsiCrossedBelow, rsiLatest } from "../indicators/rsi.js";

/**
 * Screen 2: H4 signal confirmation (relaxed)
 * BUY: RSI in buy zone (30-50) OR MACD histogram reversal
 * SELL: RSI in sell zone (50-70) OR MACD histogram reversal
 * Either condition is sufficient to confirm.
 */
export function evaluateSignal(h4Candles: Candle[], direction: TrendDirection): SignalConfirmation {
  if (direction === "FLAT") {
    return { confirmed: false, rsiValue: 0, rsiCrossed: false, macdHistReversed: false };
  }

  const closes = h4Candles.map((c) => c.close);
  const rsiValue = rsiLatest(closes, 14) ?? 0;

  let rsiCrossed: boolean;
  let macdHistReversed: boolean;

  if (direction === "BUY") {
    // Relaxed: RSI not overbought (< 75) is sufficient for buy confirmation
    rsiCrossed = rsiValue > 25 && rsiValue < 75;
    macdHistReversed = macdHistBullishReversal(closes);
  } else {
    // Relaxed: RSI not oversold (> 25) is sufficient for sell confirmation
    rsiCrossed = rsiValue > 25 && rsiValue < 75;
    macdHistReversed = macdHistBearishReversal(closes);
  }

  // Either condition is sufficient (OR instead of AND)
  const confirmed = rsiCrossed || macdHistReversed;

  return { confirmed, rsiValue, rsiCrossed, macdHistReversed };
}
