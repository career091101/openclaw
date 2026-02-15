import { runBacktest } from "./src/backtest/runner.js";
/**
 * Parameter tuning via grid search over backtest.
 * Usage: npx tsx tune.ts
 *
 * Tests combinations of:
 *   - ATR multipliers for SL (1.0, 1.5, 2.0)
 *   - ATR multipliers for TP1/TP2 (1.0/2.0, 1.5/3.0, 2.0/4.0)
 *   - minScore (1, 2, 3)
 */
import { loadConfig } from "./src/config.js";
import { fetchCandles } from "./src/data/yahoo-client.js";

interface TuneResult {
  params: { slMult: number; tp1Mult: number; tp2Mult: number; minScore: number };
  signals: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDD: number;
  maxConsecLoss: number;
}

async function main() {
  const config = loadConfig();

  console.log("Fetching historical data for parameter tuning...");
  const [d1, h1, m15] = await Promise.all([
    fetchCandles(config.symbol, "1d", "3mo", config),
    fetchCandles(config.symbol, "1h", "1mo", config),
    fetchCandles(config.symbol, "15m", "5d", config),
  ]);
  console.log(`Data: D1=${d1.length}, H1=${h1.length}, M15=${m15.length}\n`);

  const slMultipliers = [1.0, 1.5, 2.0];
  const tpPairs: [number, number][] = [
    [1.0, 2.0],
    [1.5, 3.0],
    [2.0, 4.0],
  ];
  const minScores = [1, 2, 3];

  const results: TuneResult[] = [];

  for (const slMult of slMultipliers) {
    for (const [tp1Mult, tp2Mult] of tpPairs) {
      for (const minScore of minScores) {
        const testConfig = {
          ...config,
          atrMultiplierSL: slMult,
          atrMultiplierTP1: tp1Mult,
          atrMultiplierTP2: tp2Mult,
          minScore,
        };

        const result = runBacktest(d1, h1, m15, testConfig);

        results.push({
          params: { slMult, tp1Mult, tp2Mult, minScore },
          signals: result.totalSignals,
          winRate: result.winRate,
          netPnl: result.netPnlPoints,
          profitFactor: result.profitFactor,
          maxDD: result.maxDrawdownPoints,
          maxConsecLoss: result.maxConsecutiveLosses,
        });
      }
    }
  }

  // Sort by net P/L descending
  results.sort((a, b) => b.netPnl - a.netPnl);

  // Print table
  console.log("=== Parameter Tuning Results (sorted by Net P/L) ===\n");
  console.log("  SL   TP1  TP2  minS | Signals  WR%    Net P/L   PF    MaxDD  ConsL");
  console.log("  " + "-".repeat(70));

  for (const r of results) {
    const { slMult, tp1Mult, tp2Mult, minScore } = r.params;
    const pf = r.profitFactor === Infinity ? "  Inf" : r.profitFactor.toFixed(2).padStart(5);
    const sign = r.netPnl >= 0 ? "+" : "";
    console.log(
      `  ${slMult.toFixed(1)} ${tp1Mult.toFixed(1)}  ${tp2Mult.toFixed(1)}    ${minScore}  |` +
        `   ${String(r.signals).padStart(3)}   ${r.winRate.toFixed(0).padStart(3)}%` +
        `  ${(sign + r.netPnl.toLocaleString("en-US", { maximumFractionDigits: 0 })).padStart(9)}` +
        `  ${pf}  ${("-" + r.maxDD.toLocaleString("en-US", { maximumFractionDigits: 0 })).padStart(6)}` +
        `    ${r.maxConsecLoss}`,
    );
  }

  // Highlight top 3
  console.log("\n--- Top 3 Configurations ---");
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i];
    if (r.signals === 0) {
      continue;
    }
    console.log(
      `  #${i + 1}: SL=${r.params.slMult} TP1=${r.params.tp1Mult} TP2=${r.params.tp2Mult} minScore=${r.params.minScore}` +
        ` → ${r.netPnl >= 0 ? "+" : ""}${r.netPnl}pts, WR=${r.winRate.toFixed(0)}%, PF=${r.profitFactor === Infinity ? "Inf" : r.profitFactor.toFixed(2)}, DD=-${r.maxDD}`,
    );
  }

  // Best config suggestion
  const best = results.find((r) => r.signals > 0);
  if (best) {
    console.log(`\nSuggested config update:`);
    console.log(`  atrMultiplierSL:  ${best.params.slMult}`);
    console.log(`  atrMultiplierTP1: ${best.params.tp1Mult}`);
    console.log(`  atrMultiplierTP2: ${best.params.tp2Mult}`);
    console.log(`  minScore:         ${best.params.minScore}`);
  }
}

main().catch((err) => {
  console.error("Tuning error:", err);
  process.exit(1);
});
