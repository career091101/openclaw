/**
 * check_improve_status tool: provides a summary of self-improvement status.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { loadTips, loadRuns } from "../store.js";

const CheckImproveStatusSchema = Type.Object({
  includeRuns: Type.Optional(
    Type.Boolean({ description: "Include recent run history (default: false)" }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of recent items to include (default: 10)" }),
  ),
});

export function createCheckImproveStatusTool(_options: {
  config?: OpenClawConfig;
  sessionKey?: string;
}) {
  return {
    label: "Check Improve Status",
    name: "check_improve_status",
    description:
      "Get a summary of the self-improvement system status, including tip counts by status and recent runs.",
    parameters: CheckImproveStatusSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const includeRuns = params.includeRuns === true;
      const limit = typeof params.limit === "number" ? params.limit : 10;

      try {
        const tips = await loadTips();
        const statusCounts: Record<string, number> = {};
        for (const tip of tips) {
          statusCounts[tip.status] = (statusCounts[tip.status] ?? 0) + 1;
        }

        // Get top-scoring evaluated tips
        const evaluated = tips
          .filter((t) => t.status === "evaluated")
          .toSorted((a, b) => b.scores.total - a.scores.total)
          .slice(0, limit)
          .map((t) => ({
            id: t.id,
            title: t.title,
            scores: t.scores,
            sourceUrl: t.sourceUrl,
          }));

        const result: Record<string, unknown> = {
          ok: true,
          totalTips: tips.length,
          statusCounts,
          topEvaluated: evaluated,
        };

        if (includeRuns) {
          const runs = await loadRuns();
          result.recentRuns = runs
            .toSorted((a, b) => b.startedAt - a.startedAt)
            .slice(0, limit)
            .map((r) => ({
              id: r.id,
              trigger: r.trigger,
              status: r.status,
              startedAt: r.startedAt,
              completedAt: r.completedAt,
              tipsResearched: r.tipsResearched,
              tipsImplemented: r.tipsImplemented,
              prsCreated: r.prsCreated,
            }));
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message, ok: false }) }],
        };
      }
    },
  };
}
