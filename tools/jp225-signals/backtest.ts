/**
 * CLI backtest runner.
 * Usage: npx tsx backtest.ts [--slack]
 *
 * Fetches maximum available historical data from Yahoo Finance
 * and replays the Triple Screen strategy.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { formatConsoleReport, formatSlackReport } from "./src/backtest/report.js";
import { runBacktest } from "./src/backtest/runner.js";
import { loadConfig } from "./src/config.js";
import { fetchCandles } from "./src/data/yahoo-client.js";
import { sendSlackMessage } from "./src/notifications/slack.js";

async function main() {
  const config = loadConfig();
  const sendToSlack = process.argv.includes("--slack");

  console.log("Fetching historical data...");

  const [d1, h1, m15] = await Promise.all([
    fetchCandles(config.symbol, "1d", "3mo", config),
    fetchCandles(config.symbol, "1h", "1mo", config),
    fetchCandles(config.symbol, "15m", "5d", config),
  ]);

  console.log(`Data: D1=${d1.length}, H1=${h1.length}, M15=${m15.length}`);
  console.log("Running backtest...\n");

  const result = runBacktest(d1, h1, m15, config);

  console.log(formatConsoleReport(result, "JP225 Triple Screen"));

  // Persist backtest results
  const backtestDir = join(config.stateDir, "backtest");
  mkdirSync(backtestDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(backtestDir, `backtest-${timestamp}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        config: {
          symbol: config.symbol,
          minScore: config.minScore,
          atrMultiplierSL: config.atrMultiplierSL,
          atrMultiplierTP1: config.atrMultiplierTP1,
          atrMultiplierTP2: config.atrMultiplierTP2,
          backtestSlippagePoints: config.backtestSlippagePoints,
          backtestCommissionPoints: config.backtestCommissionPoints,
        },
        stats: {
          totalSignals: result.totalSignals,
          wins: result.wins,
          losses: result.losses,
          expired: result.expired,
          winRate: result.winRate,
          totalPnlPoints: result.totalPnlPoints,
          netPnlPoints: result.netPnlPoints,
          totalSlippage: result.totalSlippage,
          profitFactor: result.profitFactor,
          maxDrawdownPoints: result.maxDrawdownPoints,
          maxConsecutiveLosses: result.maxConsecutiveLosses,
        },
        signals: result.signals.slice(0, 100),
      },
      null,
      2,
    ),
  );
  console.log(`\nResults saved to ${outPath}`);

  if (sendToSlack) {
    const msg = formatSlackReport(result, "JP225 Backtest");
    const ok = await sendSlackMessage(msg, config);
    console.log(`Slack: ${ok ? "sent" : "failed"}`);
  }
}

main().catch((err) => {
  console.error("Backtest error:", err);
  process.exit(1);
});
