/**
 * Tool Sequence Recommender: learns which tools commonly follow each other
 * in successful multi-step executions, and recommends likely next tools
 * based on the current execution context.
 *
 * Inspired by DTDR (Dynamic Tool Dependency Retrieval, arxiv:2512.17052)
 * which showed 23-104% improvement in function calling by conditioning
 * tool retrieval on the evolving execution context.
 */

import type {
  ToolTransition,
  TransitionStats,
  ToolSequenceRecommendation,
  ToolSequenceSnapshot,
} from "./types.js";

const SEQUENCE_VERSION = "1.0.0";
const MAX_TRANSITIONS_PER_SOURCE = 50;
const MAX_HISTORY_LENGTH = 20;
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Decay factor for older transitions (0–1).
 * A value of 0.95 means each day, a transition's weight
 * decreases by 5%, favouring recent patterns.
 */
const DAILY_DECAY = 0.95;

export type ToolSequenceRecommender = {
  /** Record a tool execution (call in order to build sequence data). */
  recordToolUse(toolName: string, success: boolean): void;

  /** Mark the end of a task/session to reset the sequence tracker. */
  resetSequence(): void;

  /** Get recommended next tools given what was just used. */
  getNextRecommendations(
    lastTool: string,
    availableTools?: string[],
    limit?: number,
  ): ToolSequenceRecommendation[];

  /** Get recommendations based on the full recent execution history. */
  getContextualRecommendations(
    availableTools?: string[],
    limit?: number,
  ): ToolSequenceRecommendation[];

  /** Get the raw transition stats for a source tool. */
  getTransitionStats(fromTool: string): TransitionStats[];

  /** Generate a summary string suitable for injection into agent context. */
  formatRecommendations(recs: ToolSequenceRecommendation[]): string;

  /** Generate a snapshot for persistence. */
  generateSnapshot(): ToolSequenceSnapshot;

  /** Load from a persisted snapshot. */
  loadSnapshot(snapshot: ToolSequenceSnapshot): void;

  /** Prune old data. */
  pruneOldTransitions(): void;

  /** Get current execution history (for testing/debugging). */
  getExecutionHistory(): string[];
};

export function createToolSequenceRecommender(): ToolSequenceRecommender {
  /**
   * Transition store: Map<fromTool, ToolTransition[]>
   * Each entry records a transition from one tool to another.
   */
  const transitions = new Map<string, ToolTransition[]>();

  /**
   * Current session's execution history (ordered list of tools used).
   */
  let executionHistory: string[] = [];

  function recordTransition(from: string, to: string, success: boolean): void {
    const existing = transitions.get(from) ?? [];
    existing.push({
      from,
      to,
      success,
      timestamp: Date.now(),
    });

    // Keep only the most recent MAX_TRANSITIONS_PER_SOURCE
    if (existing.length > MAX_TRANSITIONS_PER_SOURCE) {
      transitions.set(from, existing.slice(-MAX_TRANSITIONS_PER_SOURCE));
    } else {
      transitions.set(from, existing);
    }
  }

  function computeTransitionStats(fromTool: string): TransitionStats[] {
    const toolTransitions = transitions.get(fromTool);
    if (!toolTransitions || toolTransitions.length === 0) {
      return [];
    }

    // Group by target tool
    const grouped = new Map<string, ToolTransition[]>();
    for (const t of toolTransitions) {
      const existing = grouped.get(t.to) ?? [];
      existing.push(t);
      grouped.set(t.to, existing);
    }

    return Array.from(grouped.entries())
      .map(([toTool, ts]) => {
        const count = ts.length;
        const successCount = ts.filter((t) => t.success).length;
        const lastSeen = Math.max(...ts.map((t) => t.timestamp));
        return {
          from: fromTool,
          to: toTool,
          count,
          successCount,
          successRate: count > 0 ? successCount / count : 0,
          lastSeen,
        };
      })
      .toSorted((a, b) => b.count - a.count);
  }

  function computeScore(stats: TransitionStats): number {
    // Score combines:
    // 1. Frequency (how often this transition occurs) — log scale
    // 2. Success rate (how often the transition leads to success)
    // 3. Recency (how recently this transition was observed) — daily decay

    const frequencyScore = Math.log2(stats.count + 1); // Log scale: 1→1, 2→1.58, 4→2.32, 8→3.17
    const successScore = stats.successRate; // 0–1

    // Recency: days since last seen, with exponential decay
    const daysSinceLastSeen = (Date.now() - stats.lastSeen) / (24 * 60 * 60 * 1000);
    const recencyScore = Math.pow(DAILY_DECAY, daysSinceLastSeen);

    // Weighted combination: frequency (40%), success (35%), recency (25%)
    return frequencyScore * 0.4 + successScore * 0.35 + recencyScore * 0.25;
  }

  return {
    recordToolUse(toolName, success) {
      // Record transition from previous tool (if any) to current tool
      if (executionHistory.length > 0) {
        const previousTool = executionHistory[executionHistory.length - 1]!;
        recordTransition(previousTool, toolName, success);
      }

      // Add to execution history
      executionHistory.push(toolName);
      if (executionHistory.length > MAX_HISTORY_LENGTH) {
        executionHistory = executionHistory.slice(-MAX_HISTORY_LENGTH);
      }
    },

    resetSequence() {
      executionHistory = [];
    },

    getNextRecommendations(lastTool, availableTools, limit = 5) {
      const stats = computeTransitionStats(lastTool);
      if (stats.length === 0) {
        return [];
      }

      // Filter by available tools if provided
      const filtered = availableTools
        ? stats.filter((s) => availableTools.includes(s.to))
        : stats;

      // Score and sort
      return filtered
        .map((s) => ({
          toolName: s.to,
          score: computeScore(s),
          transitionCount: s.count,
          successRate: s.successRate,
        }))
        .toSorted((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    getContextualRecommendations(availableTools, limit = 5) {
      if (executionHistory.length === 0) {
        return [];
      }

      // Aggregate recommendations from recent tools in history,
      // with more weight to the most recent tool.
      const scoreMap = new Map<string, { score: number; count: number; successRate: number }>();

      // Look at the last 3 tools in history (most recent gets highest weight)
      const recentTools = executionHistory.slice(-3);
      for (let i = 0; i < recentTools.length; i++) {
        const tool = recentTools[i]!;
        const weight = (i + 1) / recentTools.length; // More recent = higher weight
        const stats = computeTransitionStats(tool);

        for (const s of stats) {
          // Skip tools already in recent history (avoid loops)
          if (executionHistory.includes(s.to)) {
            continue;
          }

          // Filter by available tools
          if (availableTools && !availableTools.includes(s.to)) {
            continue;
          }

          const existing = scoreMap.get(s.to);
          const newScore = computeScore(s) * weight;
          if (existing) {
            scoreMap.set(s.to, {
              score: existing.score + newScore,
              count: existing.count + s.count,
              successRate: (existing.successRate + s.successRate) / 2,
            });
          } else {
            scoreMap.set(s.to, {
              score: newScore,
              count: s.count,
              successRate: s.successRate,
            });
          }
        }
      }

      return Array.from(scoreMap.entries())
        .map(([toolName, data]) => ({
          toolName,
          score: data.score,
          transitionCount: data.count,
          successRate: data.successRate,
        }))
        .toSorted((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    getTransitionStats(fromTool) {
      return computeTransitionStats(fromTool);
    },

    formatRecommendations(recs) {
      if (recs.length === 0) {
        return "";
      }

      const lines = recs.map((r) => {
        const pct = (r.successRate * 100).toFixed(0);
        return `- ${r.toolName} (score: ${r.score.toFixed(2)}, used ${r.transitionCount}x after, ${pct}% success)`;
      });

      return `\n## Suggested Next Tools\n${lines.join("\n")}\n`;
    },

    generateSnapshot() {
      const snapshotTransitions: Record<string, TransitionStats[]> = {};
      for (const fromTool of transitions.keys()) {
        const stats = computeTransitionStats(fromTool);
        if (stats.length > 0) {
          snapshotTransitions[fromTool] = stats;
        }
      }

      return {
        version: SEQUENCE_VERSION,
        generatedAt: Date.now(),
        transitions: snapshotTransitions,
      };
    },

    loadSnapshot(snapshot) {
      transitions.clear();
      executionHistory = [];

      for (const [fromTool, stats] of Object.entries(snapshot.transitions)) {
        const reconstructed: ToolTransition[] = [];
        for (const s of stats) {
          // Reconstruct individual transitions from aggregate stats
          for (let i = 0; i < s.successCount; i++) {
            reconstructed.push({
              from: fromTool,
              to: s.to,
              success: true,
              timestamp: s.lastSeen - i * 60000,
            });
          }
          const failCount = s.count - s.successCount;
          for (let i = 0; i < failCount; i++) {
            reconstructed.push({
              from: fromTool,
              to: s.to,
              success: false,
              timestamp: s.lastSeen - (s.successCount + i) * 60000,
            });
          }
        }

        if (reconstructed.length > 0) {
          transitions.set(fromTool, reconstructed.slice(-MAX_TRANSITIONS_PER_SOURCE));
        }
      }
    },

    pruneOldTransitions() {
      const cutoff = Date.now() - RETENTION_MS;
      for (const [fromTool, toolTransitions] of transitions) {
        const fresh = toolTransitions.filter((t) => t.timestamp > cutoff);
        if (fresh.length === 0) {
          transitions.delete(fromTool);
        } else {
          transitions.set(fromTool, fresh.slice(-MAX_TRANSITIONS_PER_SOURCE));
        }
      }
    },

    getExecutionHistory() {
      return [...executionHistory];
    },
  };
}
