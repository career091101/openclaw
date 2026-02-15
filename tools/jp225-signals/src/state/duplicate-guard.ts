import type { Config } from "../config.js";
import type { Signal } from "../strategy/types.js";

/**
 * Check if a new signal should be suppressed due to:
 * 1. Too many active signals
 * 2. Same-direction cooldown not elapsed
 * 3. Consecutive loss limit reached
 */
export function shouldSuppressSignal(
  direction: "BUY" | "SELL",
  activeSignals: Signal[],
  lastSignalAt: number,
  consecutiveLosses: number,
  config: Config,
  lastLossAt: number = 0,
): { suppressed: boolean; reason: string } {
  // Max active signals
  if (activeSignals.length >= config.maxActiveSignals) {
    return { suppressed: true, reason: `Max active signals (${config.maxActiveSignals}) reached` };
  }

  // Same-direction cooldown
  const sameDirection = activeSignals.filter((s) => s.direction === direction);
  if (sameDirection.length > 0) {
    const latest = Math.max(...sameDirection.map((s) => s.createdAt));
    if (Date.now() - latest < config.cooldownMs) {
      return { suppressed: true, reason: `Same-direction cooldown (${direction})` };
    }
  }

  // Global cooldown from last signal
  if (lastSignalAt > 0 && Date.now() - lastSignalAt < config.cooldownMs) {
    return { suppressed: true, reason: "Global cooldown not elapsed" };
  }

  // Consecutive loss limit with time-based pause
  if (consecutiveLosses >= config.consecutiveLossLimit) {
    if (Date.now() - lastLossAt < config.consecutiveLossPauseMs) {
      return {
        suppressed: true,
        reason: `Consecutive loss limit (${consecutiveLosses}/${config.consecutiveLossLimit}), pause active`,
      };
    }
    // Pause period elapsed — allow trading to resume
  }

  return { suppressed: false, reason: "" };
}

/**
 * Check if a signal is a duplicate of an existing active signal.
 * A signal is duplicate if same direction and entry within 1 ATR.
 */
export function isDuplicate(
  direction: "BUY" | "SELL",
  entry: number,
  atrValue: number,
  activeSignals: Signal[],
): boolean {
  return activeSignals.some(
    (s) => s.direction === direction && Math.abs(s.entry - entry) < atrValue,
  );
}
