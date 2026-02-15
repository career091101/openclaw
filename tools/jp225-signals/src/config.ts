import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  symbol: string;
  alwaysOn: boolean;
  analysisIntervalMs: number;
  monitorIntervalMs: number;
  maxActiveSignals: number;
  cooldownMs: number;
  consecutiveLossLimit: number;
  consecutiveLossPauseMs: number;
  signalExpiryMs: number;
  atrMultiplierSL: number;
  atrMultiplierTP1: number;
  atrMultiplierTP2: number;
  minScore: number;
  riskPercent: number;
  accountBalance: number;
  slackBotToken: string;
  slackChannel: string;
  dailySummaryHourJST: number;
  backtestSlippagePoints: number;
  backtestCommissionPoints: number;
  stateDir: string;
  yahoo: {
    baseUrl: string;
    timeoutMs: number;
    retries: number;
  };
  marketHours: {
    closeDay: number[]; // Days of week market is closed (0=Sun, 6=Sat)
    maintenanceStartHourUTC: number;
    maintenanceEndHourUTC: number;
    warmupCandles: number; // Candles to wait after market open
  };
}

const DEFAULT_STATE_DIR = join(homedir(), ".openclaw", "state", "jp225-signals");

function getDefaultConfig(): Config {
  return {
    symbol: "NIY=F",
    alwaysOn: true,
    analysisIntervalMs: 2 * 60 * 1000, // 2 minutes
    monitorIntervalMs: 15 * 1000, // 15 seconds
    maxActiveSignals: 3,
    cooldownMs: 4 * 60 * 60 * 1000, // 4 hours
    consecutiveLossLimit: 3,
    consecutiveLossPauseMs: 24 * 60 * 60 * 1000, // 24 hours
    signalExpiryMs: 8 * 60 * 60 * 1000, // 8 hours (extended)
    atrMultiplierSL: 1.0, // tuned: tighter SL halves max drawdown (224 vs 336)
    atrMultiplierTP1: 1.5, // tuned: wider TP1 improves net P/L (+463 vs +277)
    atrMultiplierTP2: 3.0, // tuned: 3× ATR target for remaining position
    minScore: 2, // Minimum score to generate signal
    riskPercent: 1.0,
    accountBalance: 1_000_000,
    dailySummaryHourJST: 7,
    backtestSlippagePoints: 5,
    backtestCommissionPoints: 3,
    slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
    slackChannel: process.env.SLACK_CHANNEL ?? "",
    stateDir: process.env.JP225_STATE_DIR ?? DEFAULT_STATE_DIR,
    yahoo: {
      baseUrl: "https://query1.finance.yahoo.com/v8/finance/chart",
      timeoutMs: 15_000,
      retries: 3,
    },
    marketHours: {
      closeDay: [6], // Saturday only (CME Nikkei futures trade Sun-Fri)
      maintenanceStartHourUTC: 22, // 17:00 CT = 22:00 UTC
      maintenanceEndHourUTC: 23, // 18:00 CT = 23:00 UTC
      warmupCandles: 2,
    },
  };
}

export function loadConfig(): Config {
  const defaults = getDefaultConfig();
  const configPath = join(defaults.stateDir, "config.json");

  if (!existsSync(configPath)) {
    mkdirSync(defaults.stateDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  try {
    const userConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      ...defaults,
      ...userConfig,
      yahoo: { ...defaults.yahoo, ...userConfig.yahoo },
      marketHours: { ...defaults.marketHours, ...userConfig.marketHours },
    };
  } catch {
    return defaults;
  }
}
