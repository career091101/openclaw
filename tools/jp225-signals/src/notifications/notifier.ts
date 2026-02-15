import type { Config } from "../config.js";
import type { Signal, SignalState } from "../strategy/types.js";
import { formatJST, toJSTDateString } from "../state/market-hours.js";
import { sendMacOSNotification } from "./macos.js";
import { sendSlackMessage } from "./slack.js";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPercent(entry: number, target: number): string {
  const pct = ((target - entry) / entry) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatPoints(entry: number, target: number): string {
  const pts = target - entry;
  return `${pts >= 0 ? "+" : ""}${formatNumber(pts)}pts`;
}

export function buildSlackSignalMessage(signal: Signal): string {
  const dir = signal.direction;
  const emoji = dir === "BUY" ? "\u{1F4C8}" : "\u{1F4C9}";
  const slDiff = formatPoints(signal.entry, signal.stopLoss);
  const slPct = formatPercent(signal.entry, signal.stopLoss);
  const tp1Diff = formatPoints(signal.entry, signal.takeProfit1);
  const tp2Diff = formatPoints(signal.entry, signal.takeProfit2);

  const { d1, h4, m15 } = signal.details;
  const trendLabel = d1.direction === "BUY" ? "Bullish" : "Bearish";
  const emaRel = d1.ema21 > d1.ema55 ? "EMA21>55" : "EMA21<55";
  const rsiDir = h4.rsiCrossed ? "\u2191" : "\u2193";
  const macdSign = h4.macdHistReversed ? "+" : "-";

  return [
    `${emoji} *JP225 ${dir} SIGNAL*`,
    "\u2501".repeat(18),
    `*Entry:* ${formatNumber(signal.entry)}`,
    `*Stop Loss:* ${formatNumber(signal.stopLoss)} (${slDiff} / ${slPct})`,
    `*TP1:* ${formatNumber(signal.takeProfit1)} (${tp1Diff} / 50%)`,
    `*TP2:* ${formatNumber(signal.takeProfit2)} (${tp2Diff} / remaining)`,
    `*R:R:* 1:${signal.atrValue > 0 ? (Math.abs(signal.takeProfit2 - signal.entry) / Math.abs(signal.stopLoss - signal.entry)).toFixed(1) : "?"} | *Score:* ${signal.score}/5`,
    `*Position:* ${signal.positionSize ?? "-"} lots`,
    "",
    `D1: ${trendLabel} (${emaRel}, ADX ${d1.adx.toFixed(0)})`,
    `H4: RSI ${h4.rsiValue.toFixed(0)}${rsiDir} | MACD Hist ${macdSign}`,
    `M15: Stoch %K\u00D7%D from ${m15.stochK.toFixed(0)}`,
    "",
    `ATR(14)H1: ${formatNumber(signal.atrValue)}pts | ${formatJST(signal.createdAt)}`,
  ].join("\n");
}

export function buildSlackCloseMessage(signal: Signal): string {
  const statusMap: Record<string, string> = {
    tp1_hit: "\u2705 TP1 HIT",
    tp2_hit: "\u{1F389} TP2 HIT",
    sl_hit: "\u{1F6D1} STOP LOSS HIT",
    expired: "\u23F0 EXPIRED",
  };
  const label = statusMap[signal.status] ?? signal.status;
  return `${label} | JP225 ${signal.direction} @ ${formatNumber(signal.entry)} | ${formatJST(Date.now())}`;
}

export async function notifySignal(signal: Signal, config: Config): Promise<boolean> {
  const slackMsg = buildSlackSignalMessage(signal);
  const macTitle = `JP225 ${signal.direction} Signal`;
  const macBody = `Entry ${formatNumber(signal.entry)} | SL ${formatNumber(signal.stopLoss)} | TP ${formatNumber(signal.takeProfit2)} | ${signal.positionSize ?? "-"} lots`;

  const slackOk = await sendSlackMessage(slackMsg, config);
  // Always send macOS notification (fallback if Slack fails)
  await sendMacOSNotification(macTitle, macBody).catch(() => {});

  if (!slackOk) {
    await sendMacOSNotification(
      "JP225 Slack Error",
      "Slack notification failed, check token/channel",
    ).catch(() => {});
  }
  return slackOk;
}

export async function notifyClose(signal: Signal, config: Config): Promise<void> {
  const slackMsg = buildSlackCloseMessage(signal);
  await sendSlackMessage(slackMsg, config);

  const macTitle = `JP225 ${signal.status.replace("_", " ").toUpperCase()}`;
  const macBody = `${signal.direction} @ ${formatNumber(signal.entry)}`;
  await sendMacOSNotification(macTitle, macBody).catch(() => {});
}

export async function notifyHealth(message: string, config: Config): Promise<void> {
  await sendSlackMessage(`\u{1F6A8} *JP225 Health Alert*\n${message}`, config);
  await sendMacOSNotification("JP225 Health Alert", message).catch(() => {});
}

export function buildDailySummaryMessage(state: SignalState, currentPrice: number): string {
  const today = toJSTDateString();
  const stats = state.dailyStats.find((d) => d.date === today);

  const active = state.activeSignals.length;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const expired = stats?.expired ?? 0;
  const total = wins + losses + expired;
  const pnl = stats?.pnlPoints ?? 0;
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : "-";

  const pnlSign = pnl >= 0 ? "+" : "";
  const emoji = pnl > 0 ? "\u{1F4C8}" : pnl < 0 ? "\u{1F4C9}" : "\u{1F4CA}";

  const lines = [
    `${emoji} *JP225 Daily Summary — ${today}*`,
    "\u2501".repeat(18),
    `*Current Price:* ${formatNumber(currentPrice)}`,
    `*Signals Today:* ${total} (${wins}W / ${losses}L / ${expired}E)`,
    `*Win Rate:* ${winRate}%`,
    `*Day P/L:* ${pnlSign}${formatNumber(pnl)} pts`,
    `*Active:* ${active} signal${active !== 1 ? "s" : ""}`,
  ];

  if (state.activeSignals.length > 0) {
    lines.push("");
    for (const sig of state.activeSignals) {
      const unrealized =
        sig.direction === "BUY" ? currentPrice - sig.entry : sig.entry - currentPrice;
      const sign = unrealized >= 0 ? "+" : "";
      lines.push(
        `  ${sig.direction} @ ${formatNumber(sig.entry)} → ${sign}${formatNumber(unrealized)}pts`,
      );
    }
  }

  // Week stats
  const weekDates = state.dailyStats.slice(0, 5);
  if (weekDates.length > 1) {
    const weekPnl = weekDates.reduce((s, d) => s + d.pnlPoints, 0);
    const weekWins = weekDates.reduce((s, d) => s + d.wins, 0);
    const weekLosses = weekDates.reduce((s, d) => s + d.losses, 0);
    lines.push("");
    lines.push(
      `*Week:* ${weekWins}W/${weekLosses}L | ${weekPnl >= 0 ? "+" : ""}${formatNumber(weekPnl)} pts`,
    );
  }

  return lines.join("\n");
}

export async function notifyDailySummary(
  state: SignalState,
  currentPrice: number,
  config: Config,
): Promise<void> {
  const msg = buildDailySummaryMessage(state, currentPrice);
  await sendSlackMessage(msg, config);
  await sendMacOSNotification(
    "JP225 Daily Summary",
    `P/L: ${state.dailyStats[0]?.pnlPoints ?? 0}pts`,
  ).catch(() => {});
}
