/**
 * Memory decay: tracks access patterns and computes decay scores
 * for memory entries. Higher-priority and more recently/frequently
 * accessed memories resist decay longer.
 */

import type { MemoryDecayEntry, MemoryPriority } from "./types.js";

const PRIORITY_WEIGHTS: Record<MemoryPriority, number> = {
  critical: 1.0,
  high: 0.8,
  normal: 0.5,
  low: 0.2,
};

// Half-life in milliseconds for decay calculation
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type MemoryDecayTracker = {
  /** Record an access to a memory path. */
  recordAccess(path: string, priority?: MemoryPriority): void;

  /** Compute current decay scores for all tracked entries. */
  computeScores(): MemoryDecayEntry[];

  /** Get entries below a decay threshold (candidates for cleanup). */
  getDecayedEntries(threshold?: number): MemoryDecayEntry[];

  /** Get the current state for a specific path. */
  getEntry(path: string): MemoryDecayEntry | undefined;
};

export function createMemoryDecayTracker(): MemoryDecayTracker {
  const entries = new Map<
    string,
    { lastAccessed: number; accessCount: number; priority: MemoryPriority }
  >();

  function computeDecayScore(entry: {
    lastAccessed: number;
    accessCount: number;
    priority: MemoryPriority;
  }): number {
    const now = Date.now();
    const ageMs = Math.max(0, now - entry.lastAccessed);
    // Exponential decay based on age
    const timeDecay = Math.exp((-Math.LN2 * ageMs) / HALF_LIFE_MS);
    // Frequency boost (logarithmic)
    const frequencyBoost = Math.log2(1 + entry.accessCount) / 10;
    // Priority weight
    const priorityWeight = PRIORITY_WEIGHTS[entry.priority];
    // Combined score: [0, 1] range
    return Math.min(1, timeDecay * priorityWeight + frequencyBoost);
  }

  return {
    recordAccess(path, priority = "normal") {
      const existing = entries.get(path);
      if (existing) {
        existing.lastAccessed = Date.now();
        existing.accessCount += 1;
        if (priority !== "normal") {
          existing.priority = priority;
        }
      } else {
        entries.set(path, {
          lastAccessed: Date.now(),
          accessCount: 1,
          priority,
        });
      }
    },

    computeScores() {
      const results: MemoryDecayEntry[] = [];
      for (const [path, entry] of entries) {
        results.push({
          path,
          lastAccessed: entry.lastAccessed,
          accessCount: entry.accessCount,
          priority: entry.priority,
          decayScore: computeDecayScore(entry),
        });
      }
      return results.toSorted((a, b) => a.decayScore - b.decayScore);
    },

    getDecayedEntries(threshold = 0.1) {
      return this.computeScores().filter((e) => e.decayScore < threshold);
    },

    getEntry(path) {
      const entry = entries.get(path);
      if (!entry) {
        return undefined;
      }
      return {
        path,
        lastAccessed: entry.lastAccessed,
        accessCount: entry.accessCount,
        priority: entry.priority,
        decayScore: computeDecayScore(entry),
      };
    },
  };
}
