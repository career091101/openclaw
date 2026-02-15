import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { SignalState, Signal, DailyStats } from "../strategy/types.js";

const MAX_HISTORY = 100;

function emptyState(): SignalState {
  return {
    activeSignals: [],
    history: [],
    dailyStats: [],
    lastAnalysisAt: 0,
    lastSignalAt: 0,
    lastLossAt: 0,
  };
}

export class SignalStore {
  private state: SignalState;
  private filePath: string;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, "signals.json");
    this.state = this.load();
  }

  private load(): SignalState {
    if (!existsSync(this.filePath)) {
      return emptyState();
    }
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch (err: unknown) {
      console.error("SignalStore: corrupted state file:", err);
      // Backup corrupted file
      const corruptedPath = `${this.filePath}.corrupted.${Date.now()}`;
      try {
        copyFileSync(this.filePath, corruptedPath);
      } catch {}
      // Try recovering from .bak
      const bakPath = `${this.filePath}.bak`;
      if (existsSync(bakPath)) {
        try {
          const recovered = JSON.parse(readFileSync(bakPath, "utf-8"));
          console.error(`SignalStore: recovered from ${bakPath}`);
          return recovered;
        } catch {
          console.error("SignalStore: .bak also corrupted, starting fresh");
        }
      }
      return emptyState();
    }
  }

  save(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    // Backup current file before writing
    if (existsSync(this.filePath)) {
      try {
        copyFileSync(this.filePath, `${this.filePath}.bak`);
      } catch {}
    }
    const tmp = this.filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.filePath);
  }

  getState(): SignalState {
    return this.state;
  }

  getActiveSignals(): Signal[] {
    return this.state.activeSignals;
  }

  addSignal(signal: Signal): void {
    this.state.activeSignals.push(signal);
    this.state.lastSignalAt = Date.now();
    this.save();
  }

  closeSignal(signalId: string, status: Signal["status"]): Signal | null {
    const idx = this.state.activeSignals.findIndex((s) => s.id === signalId);
    if (idx === -1) {
      return null;
    }

    const signal = this.state.activeSignals[idx];
    signal.status = status;
    this.state.activeSignals.splice(idx, 1);
    this.state.history.unshift(signal);

    if (status === "sl_hit") {
      this.state.lastLossAt = Date.now();
    }

    // Trim history
    if (this.state.history.length > MAX_HISTORY) {
      this.state.history = this.state.history.slice(0, MAX_HISTORY);
    }

    // Update daily stats
    this.updateDailyStats(signal);
    this.save();
    return signal;
  }

  markTP1Hit(signalId: string): void {
    const signal = this.state.activeSignals.find((s) => s.id === signalId);
    if (signal) {
      signal.tp1Hit = true;
      this.save();
    }
  }

  updateLastAnalysis(): void {
    this.state.lastAnalysisAt = Date.now();
    this.save();
  }

  private updateDailyStats(signal: Signal): void {
    const today = new Date().toISOString().slice(0, 10);
    let stats = this.state.dailyStats.find((d) => d.date === today);
    if (!stats) {
      stats = { date: today, wins: 0, losses: 0, expired: 0, consecutiveLosses: 0, pnlPoints: 0 };
      this.state.dailyStats.unshift(stats);
      if (this.state.dailyStats.length > 30) {
        this.state.dailyStats = this.state.dailyStats.slice(0, 30);
      }
    }

    if (signal.status === "tp1_hit" || signal.status === "tp2_hit") {
      stats.wins++;
      stats.consecutiveLosses = 0;
      const pnl =
        signal.direction === "BUY"
          ? (signal.status === "tp2_hit" ? signal.takeProfit2 : signal.takeProfit1) - signal.entry
          : signal.entry - (signal.status === "tp2_hit" ? signal.takeProfit2 : signal.takeProfit1);
      stats.pnlPoints += pnl;
    } else if (signal.status === "sl_hit") {
      stats.losses++;
      stats.consecutiveLosses++;
      const pnl =
        signal.direction === "BUY"
          ? signal.stopLoss - signal.entry
          : signal.entry - signal.stopLoss;
      stats.pnlPoints += pnl;
    } else if (signal.status === "expired") {
      stats.expired++;
    }
  }

  getConsecutiveLosses(): number {
    // Count consecutive losses across recent signals
    let count = 0;
    for (const signal of this.state.history) {
      if (signal.status === "sl_hit") {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  getLastSignalTime(): number {
    return this.state.lastSignalAt;
  }

  getLastLossTime(): number {
    return this.state.lastLossAt ?? 0;
  }
}
