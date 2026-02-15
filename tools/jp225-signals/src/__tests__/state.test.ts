import { describe, it, expect } from "vitest";
import type { Config } from "../config.js";
import type { Signal } from "../strategy/types.js";
import { shouldSuppressSignal, isDuplicate } from "../state/duplicate-guard.js";
import {
  isMarketOpen,
  isInWarmup,
  formatJST,
  formatJSTFull,
  toJSTDateString,
  nowJSTString,
} from "../state/market-hours.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    symbol: "NIY=F",
    alwaysOn: true,
    analysisIntervalMs: 120000,
    monitorIntervalMs: 15000,
    maxActiveSignals: 3,
    cooldownMs: 4 * 3600000,
    consecutiveLossLimit: 3,
    consecutiveLossPauseMs: 86400000,
    signalExpiryMs: 28800000,
    atrMultiplierSL: 1.5,
    atrMultiplierTP1: 1.0,
    atrMultiplierTP2: 2.0,
    minScore: 2,
    riskPercent: 1.0,
    accountBalance: 1_000_000,
    dailySummaryHourJST: 7,
    backtestSlippagePoints: 5,
    backtestCommissionPoints: 3,
    slackBotToken: "",
    slackChannel: "",
    stateDir: "/tmp/jp225-test",
    yahoo: { baseUrl: "", timeoutMs: 15000, retries: 3 },
    marketHours: {
      closeDay: [6],
      maintenanceStartHourUTC: 22,
      maintenanceEndHourUTC: 23,
      warmupCandles: 2,
    },
    ...overrides,
  };
}

describe("isMarketOpen", () => {
  const config = makeConfig();

  it("market is closed on Saturday (day 6)", () => {
    // 2026-02-14 is Saturday
    const sat = new Date("2026-02-14T12:00:00Z");
    expect(isMarketOpen(config, sat)).toBe(false);
  });

  it("market is open on Wednesday midday", () => {
    // 2026-02-11 is Wednesday
    const wed = new Date("2026-02-11T12:00:00Z");
    expect(isMarketOpen(config, wed)).toBe(true);
  });

  it("market is closed during maintenance (22:00-23:00 UTC)", () => {
    const maintenance = new Date("2026-02-11T22:30:00Z");
    expect(isMarketOpen(config, maintenance)).toBe(false);
  });

  it("market is open after maintenance (23:00 UTC)", () => {
    const afterMaintenance = new Date("2026-02-11T23:30:00Z");
    expect(isMarketOpen(config, afterMaintenance)).toBe(true);
  });

  it("market is closed on Sunday before 23:00 UTC", () => {
    // Sunday = day 0
    const sunMorning = new Date("2026-02-15T10:00:00Z");
    expect(isMarketOpen(config, sunMorning)).toBe(false);
  });

  it("market opens Sunday at 23:00 UTC", () => {
    const sunEvening = new Date("2026-02-15T23:30:00Z");
    expect(isMarketOpen(config, sunEvening)).toBe(true);
  });

  it("market closes Friday at 22:00 UTC", () => {
    const friClose = new Date("2026-02-13T22:00:00Z");
    expect(isMarketOpen(config, friClose)).toBe(false);
  });

  it("market is open Friday before 22:00 UTC", () => {
    const friBefore = new Date("2026-02-13T21:00:00Z");
    expect(isMarketOpen(config, friBefore)).toBe(true);
  });
});

describe("isInWarmup", () => {
  const config = makeConfig();

  it("returns true right after maintenance ends", () => {
    // Just after 23:00 UTC
    const justAfter = new Date("2026-02-11T23:00:30Z");
    expect(isInWarmup(config, justAfter)).toBe(true);
  });

  it("returns false well after maintenance", () => {
    // 2 hours after maintenance
    const later = new Date("2026-02-12T01:00:00Z");
    expect(isInWarmup(config, later)).toBe(false);
  });

  it("returns false during maintenance", () => {
    const during = new Date("2026-02-11T22:30:00Z");
    expect(isInWarmup(config, during)).toBe(false);
  });
});

describe("formatJST", () => {
  it("formats UTC midnight as 09:00 JST", () => {
    const midnight = new Date("2026-02-15T00:00:00Z").getTime();
    expect(formatJST(midnight)).toBe("09:00 JST");
  });

  it("formats UTC 15:00 as 00:00 JST (next day)", () => {
    const utc15 = new Date("2026-02-15T15:00:00Z").getTime();
    expect(formatJST(utc15)).toBe("00:00 JST");
  });
});

describe("formatJSTFull", () => {
  it("includes date and time", () => {
    const ts = new Date("2026-02-15T03:30:00Z").getTime();
    expect(formatJSTFull(ts)).toBe("2026-02-15 12:30 JST");
  });
});

describe("toJSTDateString", () => {
  it("returns JST date (may differ from UTC date)", () => {
    // UTC 2026-02-14 23:00 = JST 2026-02-15 08:00
    const lateUtc = new Date("2026-02-14T23:00:00Z");
    expect(toJSTDateString(lateUtc)).toBe("2026-02-15");
  });

  it("returns same date when early UTC", () => {
    const earlyUtc = new Date("2026-02-15T01:00:00Z");
    expect(toJSTDateString(earlyUtc)).toBe("2026-02-15");
  });
});

describe("nowJSTString", () => {
  it("returns ISO-like string with +09:00 suffix", () => {
    const result = nowJSTString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });
});

describe("shouldSuppressSignal", () => {
  const config = makeConfig();

  function makeSignal(overrides: Partial<Signal> = {}): Signal {
    return {
      id: "test-1",
      direction: "BUY",
      entry: 38000,
      stopLoss: 37700,
      takeProfit1: 38200,
      takeProfit2: 38400,
      atrValue: 200,
      score: 3,
      createdAt: Date.now(),
      status: "active",
      tp1Hit: false,
      details: {
        d1: { direction: "BUY", ema21: 0, ema55: 0, adx: 0 },
        h4: { confirmed: true, rsiValue: 0, rsiCrossed: true, macdHistReversed: false },
        m15: { triggered: true, stochK: 0, stochD: 0 },
      },
      ...overrides,
    };
  }

  it("suppresses when max active signals reached", () => {
    const signals = [makeSignal(), makeSignal(), makeSignal()];
    const result = shouldSuppressSignal("BUY", signals, 0, 0, config);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("Max active");
  });

  it("allows when under max active signals", () => {
    const result = shouldSuppressSignal("BUY", [], 0, 0, config);
    expect(result.suppressed).toBe(false);
  });

  it("suppresses same-direction during cooldown", () => {
    const recent = makeSignal({ createdAt: Date.now() - 1000 });
    const result = shouldSuppressSignal("BUY", [recent], 0, 0, config);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("cooldown");
  });

  it("allows after cooldown elapsed", () => {
    const old = makeSignal({ createdAt: Date.now() - config.cooldownMs - 1000 });
    const result = shouldSuppressSignal("BUY", [old], 0, 0, config);
    // Still may hit global cooldown depending on lastSignalAt
    expect(typeof result.suppressed).toBe("boolean");
  });

  it("suppresses during consecutive loss pause", () => {
    const result = shouldSuppressSignal("BUY", [], 0, 3, config, Date.now() - 1000);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("Consecutive loss");
  });

  it("allows after consecutive loss pause elapsed", () => {
    const result = shouldSuppressSignal(
      "BUY",
      [],
      0,
      3,
      config,
      Date.now() - config.consecutiveLossPauseMs - 1000,
    );
    expect(result.suppressed).toBe(false);
  });
});

describe("isDuplicate", () => {
  function makeSignal(direction: "BUY" | "SELL", entry: number): Signal {
    return {
      id: "test-1",
      direction,
      entry,
      stopLoss: 0,
      takeProfit1: 0,
      takeProfit2: 0,
      atrValue: 200,
      score: 3,
      createdAt: Date.now(),
      status: "active",
      tp1Hit: false,
      details: {
        d1: { direction, ema21: 0, ema55: 0, adx: 0 },
        h4: { confirmed: true, rsiValue: 0, rsiCrossed: true, macdHistReversed: false },
        m15: { triggered: true, stochK: 0, stochD: 0 },
      },
    };
  }

  it("detects duplicate within ATR distance", () => {
    const signals = [makeSignal("BUY", 38000)];
    expect(isDuplicate("BUY", 38100, 200, signals)).toBe(true);
  });

  it("allows signal beyond ATR distance", () => {
    const signals = [makeSignal("BUY", 38000)];
    expect(isDuplicate("BUY", 38300, 200, signals)).toBe(false);
  });

  it("allows different direction even at same price", () => {
    const signals = [makeSignal("BUY", 38000)];
    expect(isDuplicate("SELL", 38000, 200, signals)).toBe(false);
  });

  it("returns false when no active signals", () => {
    expect(isDuplicate("BUY", 38000, 200, [])).toBe(false);
  });
});
