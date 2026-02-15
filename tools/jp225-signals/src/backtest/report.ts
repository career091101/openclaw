import type { BacktestResult, BacktestSignal } from "./runner.js";
import { formatJSTFull, toJSTDateString } from "../state/market-hours.js";

function fmt(n: number, dec: number = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: dec });
}

function signedFmt(n: number): string {
  return (n >= 0 ? "+" : "") + fmt(n);
}

/**
 * Render an ASCII sparkline chart.
 * Each column = one data point, height scaled to chartHeight rows.
 */
function asciiChart(values: number[], width: number = 60, height: number = 10): string[] {
  if (values.length === 0) {
    return [];
  }

  // Downsample if needed
  const sampled: number[] = [];
  if (values.length <= width) {
    sampled.push(...values);
  } else {
    const step = values.length / width;
    for (let i = 0; i < width; i++) {
      sampled.push(values[Math.floor(i * step)]);
    }
  }

  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;

  const lines: string[] = [];
  const labelW = Math.max(fmt(max).length, fmt(min).length) + 1;

  for (let row = height - 1; row >= 0; row--) {
    let label = "";
    if (row === height - 1) {
      label = fmt(max).padStart(labelW);
    } else if (row === 0) {
      label = fmt(min).padStart(labelW);
    } else if (row === Math.floor(height / 2)) {
      label = fmt((max + min) / 2).padStart(labelW);
    } else {
      label = " ".repeat(labelW);
    }

    let line = label + " |";
    for (const v of sampled) {
      const normalized = ((v - min) / range) * (height - 1);
      if (Math.round(normalized) >= row) {
        line +=
          v >= 0 && min < 0 && row >= Math.round(((0 - min) / range) * (height - 1)) ? "#" : ":";
      } else {
        line += " ";
      }
    }
    lines.push(line);
  }

  // Zero line
  if (min < 0 && max > 0) {
    const zeroRow = Math.round(((0 - min) / range) * (height - 1));
    const zeroLabel = "0".padStart(labelW);
    lines[height - 1 - zeroRow] = zeroLabel + " |" + "-".repeat(sampled.length);
  }

  return lines;
}

/**
 * Group signals by month (YYYY-MM) and compute per-month stats.
 */
function monthlyBreakdown(signals: BacktestSignal[]): string[] {
  if (signals.length === 0) {
    return [];
  }

  const months = new Map<string, { wins: number; losses: number; expired: number; pnl: number }>();
  for (const s of signals) {
    const dateStr = toJSTDateString(new Date(s.entryTime));
    const month = dateStr.slice(0, 7); // YYYY-MM
    const entry = months.get(month) ?? { wins: 0, losses: 0, expired: 0, pnl: 0 };
    if (s.outcome === "sl_hit") {
      entry.losses++;
    } else if (s.outcome === "expired") {
      entry.expired++;
    } else {
      entry.wins++;
    }
    entry.pnl += s.pnlPoints;
    months.set(month, entry);
  }

  const lines: string[] = ["--- Monthly Breakdown ---"];
  lines.push("  Month     W   L   E    P/L       WR%");
  lines.push("  " + "-".repeat(40));
  for (const [month, data] of months) {
    const total = data.wins + data.losses;
    const wr = total > 0 ? ((data.wins / total) * 100).toFixed(0) : " -";
    const bar = data.pnl >= 0 ? "#".repeat(Math.min(20, Math.round(data.pnl / 50))) : "";
    lines.push(
      `  ${month}   ${String(data.wins).padStart(2)} ${String(data.losses).padStart(3)} ${String(data.expired).padStart(3)}  ${signedFmt(data.pnl).padStart(8)}pts  ${String(wr).padStart(3)}%  ${bar}`,
    );
  }
  return lines;
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

  // Equity curve
  if (result.signals.length > 1) {
    const cumPnl: number[] = [];
    let running = 0;
    for (const s of result.signals) {
      running += s.pnlPoints;
      cumPnl.push(running);
    }

    lines.push("--- Equity Curve (cumulative P/L) ---");
    lines.push(...asciiChart(cumPnl));
    lines.push("");

    // Drawdown chart
    let peak = 0;
    const drawdowns: number[] = [];
    for (const v of cumPnl) {
      if (v > peak) {
        peak = v;
      }
      drawdowns.push(-(peak - v));
    }
    if (Math.min(...drawdowns) < 0) {
      lines.push("--- Drawdown ---");
      lines.push(...asciiChart(drawdowns, 60, 6));
      lines.push("");
    }

    // Win/Loss streak
    const streakLine: string[] = [];
    for (const s of result.signals) {
      if (s.outcome === "sl_hit") {
        streakLine.push("x");
      } else if (s.outcome === "expired") {
        streakLine.push("-");
      } else {
        streakLine.push("o");
      }
    }
    lines.push(`W/L Streak: ${streakLine.join("")}  (o=win x=loss -=expired)`);
    lines.push("");
  }

  // Monthly breakdown
  lines.push(...monthlyBreakdown(result.signals));

  if (result.signals.length > 0) {
    lines.push("");
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
