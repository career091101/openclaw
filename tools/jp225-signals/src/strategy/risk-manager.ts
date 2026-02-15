import type { Config } from "../config.js";
import type { Candle } from "../data/types.js";
import type { RiskLevels } from "./types.js";
import { atrLatest } from "../indicators/atr.js";

/**
 * Calculate risk levels: SL, TP1, TP2 based on ATR.
 *
 * BUY: SL = entry - 2×ATR, TP1 = entry + 2×ATR, TP2 = entry + 4×ATR
 * SELL: SL = entry + 2×ATR, TP1 = entry - 2×ATR, TP2 = entry - 4×ATR
 */
export function calculateRiskLevels(
  direction: "BUY" | "SELL",
  entry: number,
  h1Candles: Candle[],
  config: Config,
): RiskLevels | null {
  const atrValue = atrLatest(h1Candles, 14);
  if (atrValue === null || atrValue === 0) {
    return null;
  }

  const slDistance = config.atrMultiplierSL * atrValue;
  const tp1Distance = config.atrMultiplierTP1 * atrValue;
  const tp2Distance = config.atrMultiplierTP2 * atrValue;

  if (direction === "BUY") {
    return {
      entry,
      stopLoss: Math.round(entry - slDistance),
      takeProfit1: Math.round(entry + tp1Distance),
      takeProfit2: Math.round(entry + tp2Distance),
      atrValue: Math.round(atrValue),
      riskRewardRatio: tp2Distance / slDistance,
    };
  } else {
    return {
      entry,
      stopLoss: Math.round(entry + slDistance),
      takeProfit1: Math.round(entry - tp1Distance),
      takeProfit2: Math.round(entry - tp2Distance),
      atrValue: Math.round(atrValue),
      riskRewardRatio: tp2Distance / slDistance,
    };
  }
}

/**
 * Calculate position size based on account risk.
 * Risk per trade = accountBalance × riskPercent / 100
 * Position size = riskAmount / (slDistance in points)
 */
export function calculatePositionSize(entry: number, stopLoss: number, config: Config): number {
  const slDistance = Math.abs(entry - stopLoss);
  if (slDistance === 0) {
    return 0;
  }
  const riskAmount = config.accountBalance * (config.riskPercent / 100);
  return Math.floor(riskAmount / slDistance);
}
