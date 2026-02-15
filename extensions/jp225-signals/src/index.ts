import type { ExtensionRegistration } from "@openclaw/core";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".openclaw", "state", "jp225-signals");
const PLIST_NAME = "com.openclaw.jp225-signals";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);

function readJsonSafe(path: string): any {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export default {
  id: "jp225-signals",
  name: "JP225 Signals",
  description: "JP225 autonomous trading signal system - status, control, and backtest",
  kind: "extension",

  register(api: any) {
    // /jp225 status
    api.registerCli("jp225", {
      description: "JP225 signal system commands: status, start, stop, backtest",
      async execute(_args: string[]) {
        const sub = _args[0] ?? "status";

        if (sub === "status") {
          return getStatus();
        }

        if (sub === "start") {
          if (existsSync(PLIST_PATH)) {
            await exec("launchctl", ["load", PLIST_PATH]);
            return "JP225 signal daemon started.";
          }
          return "Plist not found. Run install.sh first.";
        }

        if (sub === "stop") {
          try {
            await exec("launchctl", ["unload", PLIST_PATH]);
            return "JP225 signal daemon stopped.";
          } catch {
            return "Daemon not running or plist not found.";
          }
        }

        if (sub === "signals") {
          return getSignals();
        }

        if (sub === "log") {
          const logPath = join(STATE_DIR, "stdout.log");
          if (!existsSync(logPath)) return "No log file found.";
          const lines = readFileSync(logPath, "utf-8").split("\n");
          return lines.slice(-20).join("\n");
        }

        if (sub === "config") {
          return handleConfig(_args.slice(1));
        }

        return `Unknown subcommand: ${sub}\nUsage: /jp225 [status|start|stop|signals|log|config]`;
      },
    });
  },
} satisfies ExtensionRegistration;

function handleConfig(args: string[]): string {
  const configPath = join(STATE_DIR, "config.json");
  const config = readJsonSafe(configPath);
  if (!config) return "No config.json found. Start the daemon first to generate defaults.";

  // /jp225 config — display current config
  if (args.length === 0 || (args.length === 1 && args[0] !== "set")) {
    return "```\n" + JSON.stringify(config, null, 2) + "\n```";
  }

  // /jp225 config set <key> <value>
  if (args[0] === "set") {
    if (args.length < 3)
      return "Usage: /jp225 config set <key> <value>\nExample: /jp225 config set minScore 3\nNested: /jp225 config set yahoo.timeoutMs 20000";

    const key = args[1];
    const rawValue = args.slice(2).join(" ");

    // Parse value: try number, then boolean, then string
    let value: any = rawValue;
    if (rawValue === "true") value = true;
    else if (rawValue === "false") value = false;
    else if (!isNaN(Number(rawValue)) && rawValue.trim() !== "") value = Number(rawValue);

    // Support nested keys like "yahoo.timeoutMs"
    const parts = key.split(".");
    let target = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined || typeof target[parts[i]] !== "object") {
        return `Invalid key path: ${key} (${parts[i]} is not an object)`;
      }
      target = target[parts[i]];
    }

    const finalKey = parts[parts.length - 1];
    const oldValue = target[finalKey];
    target[finalKey] = value;

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return `Updated ${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}\nNote: Restart the daemon for changes to take effect.`;
  }

  return "Usage: /jp225 config [set <key> <value>]";
}

function getStatus(): string {
  const heartbeat = readJsonSafe(join(STATE_DIR, "heartbeat.json"));
  const config = readJsonSafe(join(STATE_DIR, "config.json"));
  const signals = readJsonSafe(join(STATE_DIR, "signals.json"));

  if (!heartbeat) return "JP225 signal system: NOT RUNNING (no heartbeat found)";

  const lastBeat = new Date(heartbeat.timestamp);
  const ageSec = (Date.now() - heartbeat.timestamp) / 1000;
  const alive = ageSec < 600; // Consider alive if heartbeat within 10 min

  const lines = [
    `JP225 Signal System: ${alive ? "RUNNING" : "STALE (heartbeat " + Math.round(ageSec) + "s ago)"}`,
    `Last heartbeat: ${lastBeat.toISOString()}`,
    `Active signals: ${heartbeat.activeSignals}`,
    `Symbol: ${config?.symbol ?? "NIY=F"}`,
    `Analysis: ${(config?.analysisIntervalMs ?? 0) / 1000}s | Monitor: ${(config?.monitorIntervalMs ?? 0) / 1000}s`,
  ];

  if (signals?.dailyStats?.[0]) {
    const d = signals.dailyStats[0];
    lines.push(`Today (${d.date}): ${d.wins}W/${d.losses}L/${d.expired}E | P/L: ${d.pnlPoints}pts`);
  }

  return lines.join("\n");
}

function getSignals(): string {
  const signals = readJsonSafe(join(STATE_DIR, "signals.json"));
  if (!signals) return "No signal data found.";

  const lines: string[] = [];

  if (signals.activeSignals.length > 0) {
    lines.push("--- Active ---");
    for (const s of signals.activeSignals) {
      const age = ((Date.now() - s.createdAt) / 60000).toFixed(0);
      lines.push(
        `  ${s.direction} @ ${s.entry} | SL ${s.stopLoss} | TP ${s.takeProfit2} | ${age}min`,
      );
    }
  } else {
    lines.push("No active signals.");
  }

  if (signals.history.length > 0) {
    lines.push("\n--- Recent History ---");
    for (const s of signals.history.slice(0, 5)) {
      const date = new Date(s.createdAt).toISOString().slice(0, 16);
      lines.push(`  ${date} ${s.direction} @ ${s.entry} → ${s.status}`);
    }
  }

  return lines.join("\n");
}
