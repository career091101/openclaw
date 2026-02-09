/**
 * Gateway method: improve.status
 * Returns the current status of the self-improvement system.
 */

import { loadTips, loadRuns } from "../store.js";

type RespondFn = (success: boolean, data?: unknown, error?: unknown) => void;

export async function handleImproveStatus(opts: {
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<void> {
  try {
    const tips = await loadTips();
    const runs = await loadRuns();

    const statusCounts: Record<string, number> = {};
    for (const tip of tips) {
      statusCounts[tip.status] = (statusCounts[tip.status] ?? 0) + 1;
    }

    const topEvaluated = tips
      .filter((t) => t.status === "evaluated")
      .toSorted((a, b) => b.scores.total - a.scores.total)
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        title: t.title,
        scores: t.scores,
        sourceUrl: t.sourceUrl,
      }));

    const latestRun = runs.toSorted((a, b) => b.startedAt - a.startedAt)[0] ?? null;

    opts.respond(true, {
      totalTips: tips.length,
      statusCounts,
      topEvaluated,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            trigger: latestRun.trigger,
            status: latestRun.status,
            startedAt: latestRun.startedAt,
            completedAt: latestRun.completedAt,
            tipsResearched: latestRun.tipsResearched,
            tipsImplemented: latestRun.tipsImplemented,
          }
        : null,
      totalRuns: runs.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.respond(false, undefined, { code: -1, message });
  }
}
