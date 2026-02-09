/**
 * evaluate_tip tool: scores a discovered tip on relevance, feasibility, and impact.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import type { TipRecord, TipScores } from "../types.js";
import { isDuplicate } from "../dedup.js";
import { saveTip } from "../store.js";
import { loadTips } from "../store.js";

const EvaluateTipSchema = Type.Object({
  title: Type.String({ description: "Short title of the discovered tip" }),
  summary: Type.String({ description: "Summary of the improvement tip (2-3 sentences)" }),
  sourceUrl: Type.String({ description: "URL where the tip was discovered" }),
  relevanceScore: Type.Number({
    description: "How relevant to OpenClaw agent system (0-10)",
    minimum: 0,
    maximum: 10,
  }),
  feasibilityScore: Type.Number({
    description: "How feasible to implement within allowed scope (0-10)",
    minimum: 0,
    maximum: 10,
  }),
  impactScore: Type.Number({
    description: "How much this would improve agent autonomy (0-10)",
    minimum: 0,
    maximum: 10,
  }),
  recommendation: Type.String({ description: "Recommendation: accept, reject, or defer" }),
  reasoning: Type.String({ description: "Brief reasoning for the scores and recommendation" }),
});

export function createEvaluateTipTool(_options: { config?: OpenClawConfig; sessionKey?: string }) {
  return {
    label: "Evaluate Tip",
    name: "evaluate_tip",
    description:
      "Evaluate a discovered autonomy improvement tip. Scores it on relevance, feasibility, and impact, then saves to the tip store.",
    parameters: EvaluateTipSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const title = typeof params.title === "string" ? params.title : "";
      const summary = typeof params.summary === "string" ? params.summary : "";
      const sourceUrl = typeof params.sourceUrl === "string" ? params.sourceUrl : "";
      const relevanceScore = typeof params.relevanceScore === "number" ? params.relevanceScore : 0;
      const feasibilityScore =
        typeof params.feasibilityScore === "number" ? params.feasibilityScore : 0;
      const impactScore = typeof params.impactScore === "number" ? params.impactScore : 0;
      const recommendation =
        typeof params.recommendation === "string" ? params.recommendation : "reject";
      const reasoning = typeof params.reasoning === "string" ? params.reasoning : "";

      if (!title || !summary || !sourceUrl) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "title, summary, and sourceUrl are required",
                ok: false,
              }),
            },
          ],
        };
      }

      try {
        // Check for duplicates
        const existingTips = await loadTips();
        const dupCheck = isDuplicate({ title, summary, sourceUrl }, existingTips);
        if (dupCheck.duplicate) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: false,
                  error: "duplicate tip detected",
                  matchedTipId: dupCheck.matchedTipId,
                  similarity: dupCheck.similarity,
                }),
              },
            ],
          };
        }

        const scores: TipScores = {
          relevance: relevanceScore,
          feasibility: feasibilityScore,
          impact: impactScore,
          total: relevanceScore + feasibilityScore + impactScore,
        };

        const status = recommendation === "accept" ? "evaluated" : "rejected";

        const tip: TipRecord = {
          id: randomUUID(),
          title,
          summary,
          sourceUrl,
          discoveredAt: Date.now(),
          scores,
          status,
          rejectionReason: status === "rejected" ? reasoning : undefined,
        };

        await saveTip(tip);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                tipId: tip.id,
                title: tip.title,
                scores,
                status: tip.status,
                reasoning,
              }),
            },
          ],
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
