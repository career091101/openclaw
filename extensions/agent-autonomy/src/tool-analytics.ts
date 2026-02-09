/**
 * Tool usage analytics: tracks success/failure rates and performance metrics
 * for each tool to help agents make better tool selection decisions.
 */

import type {
  ToolExecutionRecord,
  ToolAnalytics,
  ToolAnalyticsSnapshot,
  ToolErrorCategory,
} from "./types.js";

const ANALYTICS_VERSION = "1.0.0";
const MAX_RECORDS_PER_TOOL = 100;
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type ToolAnalyticsTracker = {
  /** Record a tool execution result */
  recordExecution(params: {
    toolName: string;
    success: boolean;
    executionTimeMs: number;
    errorCategory?: ToolErrorCategory;
  }): void;

  /** Get analytics for a specific tool */
  getToolAnalytics(toolName: string): ToolAnalytics | undefined;

  /** Get analytics for all tools */
  getAllAnalytics(): ToolAnalytics[];

  /** Generate a snapshot for persistence */
  generateSnapshot(): ToolAnalyticsSnapshot;

  /** Load from a snapshot */
  loadSnapshot(snapshot: ToolAnalyticsSnapshot): void;

  /** Get contextual recommendations for tool selection */
  getRecommendations(toolNames: string[]): string | undefined;

  /** Prune old records */
  pruneOldRecords(): void;
};

export function createToolAnalyticsTracker(): ToolAnalyticsTracker {
  const records = new Map<string, ToolExecutionRecord[]>();

  function pruneOldRecords(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [toolName, toolRecords] of records) {
      const fresh = toolRecords.filter((r) => r.timestamp > cutoff);
      if (fresh.length === 0) {
        records.delete(toolName);
      } else {
        // Keep only MAX_RECORDS_PER_TOOL most recent
        records.set(toolName, fresh.slice(-MAX_RECORDS_PER_TOOL));
      }
    }
  }

  function computeAnalytics(toolName: string): ToolAnalytics | undefined {
    const toolRecords = records.get(toolName);
    if (!toolRecords || toolRecords.length === 0) {
      return undefined;
    }

    const totalCalls = toolRecords.length;
    const successfulCalls = toolRecords.filter((r) => r.success).length;
    const failedCalls = totalCalls - successfulCalls;
    const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;

    const totalTime = toolRecords.reduce((sum, r) => sum + r.executionTimeMs, 0);
    const averageExecutionTimeMs = totalTime / totalCalls;

    // Count error categories
    const errorCounts = new Map<ToolErrorCategory, number>();
    for (const record of toolRecords) {
      if (record.errorCategory) {
        errorCounts.set(record.errorCategory, (errorCounts.get(record.errorCategory) ?? 0) + 1);
      }
    }

    const commonErrors = Array.from(errorCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .toSorted((a, b) => b.count - a.count)
      .slice(0, 5);

    const lastUsed = Math.max(...toolRecords.map((r) => r.timestamp));

    return {
      toolName,
      totalCalls,
      successfulCalls,
      failedCalls,
      successRate,
      averageExecutionTimeMs,
      commonErrors,
      lastUsed,
    };
  }

  return {
    recordExecution(params) {
      const existing = records.get(params.toolName) ?? [];
      existing.push({
        toolName: params.toolName,
        success: params.success,
        executionTimeMs: params.executionTimeMs,
        errorCategory: params.errorCategory,
        timestamp: Date.now(),
      });

      // Keep only the most recent MAX_RECORDS_PER_TOOL
      if (existing.length > MAX_RECORDS_PER_TOOL) {
        records.set(params.toolName, existing.slice(-MAX_RECORDS_PER_TOOL));
      } else {
        records.set(params.toolName, existing);
      }
    },

    getToolAnalytics(toolName) {
      return computeAnalytics(toolName);
    },

    getAllAnalytics() {
      const allToolNames = Array.from(records.keys());
      return allToolNames
        .map((name) => computeAnalytics(name))
        .filter((a): a is ToolAnalytics => a !== undefined)
        .toSorted((a, b) => b.totalCalls - a.totalCalls);
    },

    generateSnapshot() {
      const tools: Record<string, ToolAnalytics> = {};
      for (const toolName of records.keys()) {
        const analytics = computeAnalytics(toolName);
        if (analytics) {
          tools[toolName] = analytics;
        }
      }

      return {
        version: ANALYTICS_VERSION,
        generatedAt: Date.now(),
        tools,
      };
    },

    loadSnapshot(snapshot) {
      // Clear existing records
      records.clear();

      // Reconstruct records from snapshot analytics
      // Note: We only store aggregate stats, not individual records
      // This is intentional to keep snapshot size small
      for (const [toolName, analytics] of Object.entries(snapshot.tools)) {
        // Create synthetic records to represent the aggregated data
        const syntheticRecords: ToolExecutionRecord[] = [];

        // Create success records
        for (let i = 0; i < analytics.successfulCalls; i++) {
          syntheticRecords.push({
            toolName,
            success: true,
            executionTimeMs: analytics.averageExecutionTimeMs,
            timestamp: analytics.lastUsed - i * 60000, // Spread over last hour
          });
        }

        // Create failure records
        for (const error of analytics.commonErrors) {
          for (let i = 0; i < Math.min(error.count, 10); i++) {
            syntheticRecords.push({
              toolName,
              success: false,
              executionTimeMs: analytics.averageExecutionTimeMs,
              errorCategory: error.category,
              timestamp: analytics.lastUsed - i * 60000,
            });
          }
        }

        if (syntheticRecords.length > 0) {
          records.set(toolName, syntheticRecords.slice(-MAX_RECORDS_PER_TOOL));
        }
      }
    },

    getRecommendations(toolNames) {
      if (toolNames.length === 0) {
        return undefined;
      }

      const recommendations: string[] = [];
      const toolStats = toolNames
        .map((name) => ({ name, analytics: computeAnalytics(name) }))
        .filter((t): t is { name: string; analytics: ToolAnalytics } => t.analytics !== undefined);

      if (toolStats.length === 0) {
        return undefined;
      }

      // Sort by success rate
      toolStats.sort((a, b) => b.analytics.successRate - a.analytics.successRate);

      const best = toolStats[0];
      const worst = toolStats[toolStats.length - 1];

      if (best && best.analytics.successRate > 0.8 && best.analytics.totalCalls >= 5) {
        recommendations.push(
          `Tool "${best.name}" has a ${(best.analytics.successRate * 100).toFixed(0)}% success rate (${best.analytics.successfulCalls}/${best.analytics.totalCalls} calls) - highly reliable.`,
        );
      }

      if (worst && worst.analytics.successRate < 0.5 && worst.analytics.totalCalls >= 3) {
        const topError = worst.analytics.commonErrors[0];
        const errorDetail = topError ? ` Most common error: ${topError.category}.` : "";
        recommendations.push(
          `Tool "${worst.name}" has a low success rate (${(worst.analytics.successRate * 100).toFixed(0)}%).${errorDetail} Consider alternatives.`,
        );
      }

      // Performance insights
      const fastTools = toolStats.filter((t) => t.analytics.averageExecutionTimeMs < 1000);
      const slowTools = toolStats.filter((t) => t.analytics.averageExecutionTimeMs > 5000);

      if (fastTools.length > 0 && slowTools.length > 0) {
        const fastest = fastTools.reduce((a, b) =>
          a.analytics.averageExecutionTimeMs < b.analytics.averageExecutionTimeMs ? a : b,
        );
        recommendations.push(
          `Tool "${fastest.name}" is fastest (avg ${fastest.analytics.averageExecutionTimeMs.toFixed(0)}ms).`,
        );
      }

      return recommendations.length > 0
        ? `\n## Tool Selection Insights\n${recommendations.join("\n")}\n`
        : undefined;
    },

    pruneOldRecords,
  };
}
