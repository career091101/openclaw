import type { Config } from "../config.js";

/**
 * Determine if the market is currently open for trading.
 * CME Nikkei 225 futures (NIY=F) trade Sunday-Friday with
 * a daily maintenance window.
 */
export function isMarketOpen(config: Config, now: Date = new Date()): boolean {
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  const hour = now.getUTCHours();

  // Check closed days
  if (config.marketHours.closeDay.includes(day)) {
    return false;
  }

  // Sunday: market opens at 23:00 UTC (18:00 CT)
  if (day === 0 && hour < 23) {
    return false;
  }

  // Friday: market closes at 22:00 UTC (17:00 CT)
  if (day === 5 && hour >= 22) {
    return false;
  }

  // Daily maintenance window
  const { maintenanceStartHourUTC, maintenanceEndHourUTC } = config.marketHours;
  if (hour >= maintenanceStartHourUTC && hour < maintenanceEndHourUTC) {
    return false;
  }

  return true;
}

/**
 * Check if the market just reopened and is still in the warmup period.
 * Returns true for `warmupCandles × analysisIntervalMs` after maintenance ends.
 */
export function isInWarmup(config: Config, now: Date = new Date()): boolean {
  const hour = now.getUTCHours();
  const { maintenanceEndHourUTC, warmupCandles } = config.marketHours;
  const warmupMs = warmupCandles * config.analysisIntervalMs;

  // How many ms since maintenance ended today
  const msSinceMidnight = (hour * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) * 1000;
  const maintenanceEndMs = maintenanceEndHourUTC * 3600 * 1000;
  const elapsed = msSinceMidnight - maintenanceEndMs;

  // Only suppress if we're in the window right after maintenance ends
  if (elapsed >= 0 && elapsed < warmupMs) {
    return true;
  }
  return false;
}

/**
 * Format a timestamp as JST time string (HH:MM JST)
 */
export function formatJST(timestamp: number): string {
  const d = new Date(timestamp);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} JST`;
}
