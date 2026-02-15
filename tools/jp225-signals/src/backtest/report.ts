import type { BacktestResult } from "./runner.js";
import { formatJSTFull } from "../state/market-hours.js";

function fmt(n: number, dec: number = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: dec });
}

export function formatConsoleReport(result: BacktestResult, label: string = "Backtest"): string {
  const lines: string[] = [
    `=== ${label} Results ===`,
    "",
    `Signals:    ${result.totalSignals} total (${result.wins}W / ${result.losses}L / ${result.expired}E)`,
    `Win Rate:   ${result.winRate.toFixed(1)}%`,
    `Gross P/L:  ${fmt(result.totalPnlPoints)} pts`,
    `Slippage:   -${fmt(result.totalSlippage)} pts`,
    `Costs:      -${fmt(result.totalPnlPoints - result.netPnlPoints)} pts`,
    `Net P/L:    ${fmt(result.netPnlPoints)} pts`,
    `Avg Win:    +${fmt(result.avgWinPoints)} pts`,
    `Avg Loss:   -${fmt(result.avgLossPoints)} pts`,
    `Profit F:   ${result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2)}`,
    `Max DD:     -${fmt(result.maxDrawdownPoints)} pts`,
    `Max Consec Loss: ${result.maxConsecutiveLosses}`,
    "",
  ];

  if (result.signals.length > 0) {
    lines.push("--- Signal Log ---");
    for (const s of result.signals) {
      const date = formatJSTFull(s.entryTime);
      const pnl = s.pnlPoints >= 0 ? `+${fmt(s.pnlPoints)}` : fmt(s.pnlPoints);
      const tag = s.outcome.replace("_then_", "→").padEnd(12);
      lines.push(
        `  ${date} ${s.direction} @ ${fmt(s.entry)} → ${tag} ${pnl}pts (score ${s.score})`,
      );
    }
  }

  return lines.join("\n");
}

export function formatSlackReport(result: BacktestResult, label: string = "Backtest"): string {
  const emoji = result.totalPnlPoints >= 0 ? "\u{1F4CA}" : "\u{1F4C9}";
  return [
    `${emoji} *${label} Results*`,
    "\u2501".repeat(18),
    `*Signals:* ${result.totalSignals} (${result.wins}W / ${result.losses}L / ${result.expired}E)`,
    `*Win Rate:* ${result.winRate.toFixed(1)}%`,
    `*Gross P/L:* ${result.totalPnlPoints >= 0 ? "+" : ""}${fmt(result.totalPnlPoints)} pts`,
    `*Net P/L:* ${result.netPnlPoints >= 0 ? "+" : ""}${fmt(result.netPnlPoints)} pts (slip -${fmt(result.totalSlippage)})`,
    `*Profit Factor:* ${result.profitFactor === Infinity ? "\u221E" : result.profitFactor.toFixed(2)}`,
    `*Max Drawdown:* -${fmt(result.maxDrawdownPoints)} pts`,
    `*Max Consec Loss:* ${result.maxConsecutiveLosses}`,
  ].join("\n");
}
