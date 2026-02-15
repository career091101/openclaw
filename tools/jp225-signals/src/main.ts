import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MultiTimeframeData } from "./data/types.js";
import { loadConfig, type Config } from "./config.js";
import { aggregateToH4, hasExcessiveGap } from "./data/candle-aggregator.js";
import { fetchAllTimeframes, fetchCurrentPrice } from "./data/yahoo-client.js";
import {
  notifySignal,
  notifyClose,
  notifyHealth,
  notifyDailySummary,
} from "./notifications/notifier.js";
import { shouldSuppressSignal, isDuplicate } from "./state/duplicate-guard.js";
import { isMarketOpen, isInWarmup, nowJSTString, toJSTDateString } from "./state/market-hours.js";
import { SignalStore } from "./state/signal-store.js";
import { evaluate, checkSignalStatus } from "./strategy/signal-evaluator.js";

let config: Config;
let store: SignalStore;
let lastHealthAlert = 0;
let consecutiveDataFailures = 0;
let lastDailySummaryDate = "";
let circuitBreakerMultiplier = 1;
let lastAnalysisAttempt = 0;

function log(msg: string): void {
  const ts = nowJSTString();
  console.log(`[${ts}] ${msg}`);
}

function writeHeartbeat(): void {
  const path = join(config.stateDir, "heartbeat.json");
  writeFileSync(
    path,
    JSON.stringify({
      timestamp: Date.now(),
      iso: nowJSTString(),
      activeSignals: store.getActiveSignals().length,
    }),
  );
}

async function fetchData(): Promise<MultiTimeframeData | null> {
  try {
    const raw = await fetchAllTimeframes(config);
    consecutiveDataFailures = 0;
    circuitBreakerMultiplier = 1;

    const h4 = aggregateToH4(raw.h1_monthly);

    // Check for excessive gaps
    const H1_MS = 60 * 60 * 1000;
    const H4_MS = 4 * H1_MS;
    if (hasExcessiveGap(h4, H4_MS) || hasExcessiveGap(raw.h1_weekly, H1_MS)) {
      log("WARNING: Excessive data gap detected, skipping analysis");
      return null;
    }

    // Data freshness check: latest M15 candle should be within 30 minutes
    const STALE_THRESHOLD_MS = 30 * 60 * 1000;
    if (raw.m15.length > 0) {
      const latestM15 = raw.m15[raw.m15.length - 1].timestamp;
      if (Date.now() - latestM15 > STALE_THRESHOLD_MS) {
        log(
          `WARNING: Stale M15 data (latest candle ${Math.round((Date.now() - latestM15) / 60000)}min old), skipping`,
        );
        return null;
      }
    }

    return {
      d1: raw.d1,
      h4,
      h1: raw.h1_weekly,
      m15: raw.m15,
      currentPrice: raw.currentPrice,
      fetchedAt: Date.now(),
    };
  } catch (err: unknown) {
    consecutiveDataFailures++;
    log(
      `ERROR fetching data (${consecutiveDataFailures}): ${err instanceof Error ? err.message : String(err)}`,
    );

    // Circuit breaker: increase backoff on repeated failures
    if (consecutiveDataFailures >= 3) {
      circuitBreakerMultiplier = Math.min(circuitBreakerMultiplier * 2, 8);
      log(`Circuit breaker: multiplier=${circuitBreakerMultiplier}`);
    }

    // Every 5 consecutive failures, try a fallback fetch with 3× timeout
    if (consecutiveDataFailures % 5 === 0) {
      log("Attempting fallback fetch with extended timeout...");
      try {
        const fallbackConfig = {
          ...config,
          yahoo: { ...config.yahoo, timeoutMs: config.yahoo.timeoutMs * 3 },
        };
        const raw = await fetchAllTimeframes(fallbackConfig);
        consecutiveDataFailures = 0;
        circuitBreakerMultiplier = 1;
        log("Fallback fetch succeeded, circuit breaker reset");
        const h4 = aggregateToH4(raw.h1_monthly);
        return {
          d1: raw.d1,
          h4,
          h1: raw.h1_weekly,
          m15: raw.m15,
          currentPrice: raw.currentPrice,
          fetchedAt: Date.now(),
        };
      } catch {
        log("Fallback fetch also failed");
      }
    }

    // Health alert after 30 minutes of failures
    const HEALTH_THRESHOLD_MS = 30 * 60 * 1000;
    if (consecutiveDataFailures * config.analysisIntervalMs >= HEALTH_THRESHOLD_MS) {
      if (Date.now() - lastHealthAlert > HEALTH_THRESHOLD_MS) {
        lastHealthAlert = Date.now();
        await notifyHealth(
          `Data fetch failing for ${consecutiveDataFailures} consecutive attempts`,
          config,
        );
      }
    }
    return null;
  }
}

async function analysisLoop(): Promise<void> {
  if (!config.alwaysOn) {
    if (!isMarketOpen(config)) {
      log("Market closed, skipping analysis");
      return;
    }
    if (isInWarmup(config)) {
      log("Post-maintenance warmup period, skipping analysis");
      return;
    }
  }

  // Circuit breaker: throttle analysis during repeated failures
  if (Date.now() - lastAnalysisAttempt < config.analysisIntervalMs * circuitBreakerMultiplier) {
    return;
  }
  lastAnalysisAttempt = Date.now();

  const data = await fetchData();
  if (!data) {
    return;
  }

  log(
    `Data fetched: price=${data.currentPrice}, D1=${data.d1.length}, H4=${data.h4.length}, H1=${data.h1.length}, M15=${data.m15.length}`,
  );

  const result = evaluate(data, config);
  store.updateLastAnalysis();

  if (!result.signal) {
    log(`No signal: ${result.reason}`);
    return;
  }

  const signal = result.signal;

  // Duplicate check
  if (isDuplicate(signal.direction, signal.entry, signal.atrValue, store.getActiveSignals())) {
    log(`Duplicate signal suppressed: ${signal.direction} @ ${signal.entry}`);
    return;
  }

  // Suppression checks
  const suppression = shouldSuppressSignal(
    signal.direction,
    store.getActiveSignals(),
    store.getLastSignalTime(),
    store.getConsecutiveLosses(),
    config,
    store.getLastLossTime(),
  );
  if (suppression.suppressed) {
    log(`Signal suppressed: ${suppression.reason}`);
    return;
  }

  // Signal is valid - store and notify
  store.addSignal(signal);
  log(
    `SIGNAL: ${signal.direction} @ ${signal.entry} | SL ${signal.stopLoss} | TP1 ${signal.takeProfit1} | TP2 ${signal.takeProfit2} | Score ${signal.score}/5`,
  );

  const slackOk = await notifySignal(signal, config);
  log(`Notification sent: Slack=${slackOk ? "OK" : "FAIL"}`);
}

async function monitorLoop(): Promise<void> {
  // Skip API calls when market is closed (unless alwaysOn)
  if (!config.alwaysOn && !isMarketOpen(config)) {
    return;
  }

  const activeSignals = store.getActiveSignals();
  if (activeSignals.length === 0) {
    return;
  }

  let currentPrice: number;
  try {
    currentPrice = await fetchCurrentPrice(config.symbol, config);
  } catch {
    return; // Will retry next cycle
  }

  // Fix #1: Log monitor checks for visibility
  log(`Monitor: price=${currentPrice}, active=${activeSignals.length}`);

  for (const signal of activeSignals) {
    // Fix #2: Check SL/TP BEFORE expiry so price-based exits take priority
    const status = checkSignalStatus(signal, currentPrice);

    if (status === "sl") {
      const closed = store.closeSignal(signal.id, "sl_hit");
      if (closed) {
        log(`SL HIT: ${signal.direction} @ ${signal.entry}, price=${currentPrice}`);
        await notifyClose(closed, config);
      }
    } else if (status === "tp1") {
      store.markTP1Hit(signal.id);
      log(`TP1 HIT: ${signal.direction} @ ${signal.entry}, price=${currentPrice}`);
      const updated = store.getActiveSignals().find((s) => s.id === signal.id);
      if (updated) {
        await notifyClose({ ...updated, status: "tp1_hit" }, config);
      }
    } else if (status === "tp2") {
      const closed = store.closeSignal(signal.id, "tp2_hit");
      if (closed) {
        log(`TP2 HIT: ${signal.direction} @ ${signal.entry}, price=${currentPrice}`);
        await notifyClose(closed, config);
      }
    } else if (Date.now() - signal.createdAt > config.signalExpiryMs) {
      // Expiry only checked if no SL/TP hit
      const closed = store.closeSignal(signal.id, "expired");
      if (closed) {
        log(`EXPIRED: ${signal.direction} @ ${signal.entry}, price=${currentPrice}`);
        await notifyClose(closed, config);
      }
    }
  }
}

async function main(): Promise<void> {
  config = loadConfig();
  mkdirSync(config.stateDir, { recursive: true });

  store = new SignalStore(config.stateDir);

  log("JP225 Signal System starting");
  log(
    `Symbol: ${config.symbol} | Analysis: ${config.analysisIntervalMs / 1000}s | Monitor: ${config.monitorIntervalMs / 1000}s | 24h: ${config.alwaysOn}`,
  );
  log(`Active signals: ${store.getActiveSignals().length}`);

  // Initial run
  await analysisLoop();
  writeHeartbeat();

  // Analysis loop
  setInterval(async () => {
    try {
      await analysisLoop();
      writeHeartbeat();
    } catch (err: unknown) {
      log(`Analysis loop error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, config.analysisIntervalMs);

  // Monitor loop
  setInterval(async () => {
    try {
      await monitorLoop();
      writeHeartbeat();
    } catch (err: unknown) {
      log(`Monitor loop error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, config.monitorIntervalMs);

  // Daily summary (check every 5 minutes, send once at 07:00 JST = maintenance start)
  setInterval(
    async () => {
      try {
        const now = new Date();
        const jstHour = (now.getUTCHours() + 9) % 24;
        const today = toJSTDateString(now);
        if (jstHour === config.dailySummaryHourJST && lastDailySummaryDate !== today) {
          lastDailySummaryDate = today;
          let price = 0;
          try {
            price = await fetchCurrentPrice(config.symbol, config);
          } catch {}
          await notifyDailySummary(store.getState(), price, config);
          log("Daily summary sent");
        }
      } catch (err: unknown) {
        log(`Daily summary error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    5 * 60 * 1000,
  );

  // Keep process alive
  process.on("SIGINT", () => {
    log("Shutting down gracefully");
    store.save();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log("Shutting down gracefully");
    store.save();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
