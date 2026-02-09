/**
 * Gateway method: improve.history
 * Returns historical data for self-improvement runs and tips.
 */

import type { TipStatus } from "../types.js";
import { loadTips, loadRuns } from "../store.js";

type RespondFn = (success: boolean, data?: unknown, error?: unknown) => void;

export async function handleImproveHistory(opts: {
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<void> {
  const limit = typeof opts.params.limit === "number" ? opts.params.limit : 20;
  const includeTips = opts.params.includeTips === true;
  const statusFilter =
    typeof opts.params.status === "string" ? (opts.params.status as TipStatus) : undefined;

  try {
    const runs = await loadRuns();
    const sortedRuns = runs
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
        error: r.error,
      }));

    const result: Record<string, unknown> = {
      runs: sortedRuns,
      totalRuns: runs.length,
    };

    if (includeTips) {
      let tips = await loadTips();
      if (statusFilter) {
        tips = tips.filter((t) => t.status === statusFilter);
      }
      result.tips = tips
        .toSorted((a, b) => b.discoveredAt - a.discoveredAt)
        .slice(0, limit)
        .map((t) => ({
          id: t.id,
          title: t.title,
          summary: t.summary,
          sourceUrl: t.sourceUrl,
          scores: t.scores,
          status: t.status,
          discoveredAt: t.discoveredAt,
          implementationPr: t.implementationPr,
          rejectionReason: t.rejectionReason,
        }));
      result.totalTips = tips.length;
    }

    opts.respond(true, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.respond(false, undefined, { code: -1, message });
  }
}
