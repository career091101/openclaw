/**
 * CLI command: openclaw improve history
 * Shows the history of self-improvement runs and tips.
 */

import type { TipStatus } from "../types.js";
import { loadTips, loadRuns } from "../store.js";

export type ImproveHistoryOptions = {
  limit?: number;
  tips?: boolean;
  status?: string;
};

export async function handleImproveHistory(options: ImproveHistoryOptions): Promise<void> {
  const limit = options.limit ?? 20;

  if (options.tips) {
    await showTipHistory(limit, options.status as TipStatus | undefined);
  } else {
    await showRunHistory(limit);
  }
}

async function showRunHistory(limit: number): Promise<void> {
  const runs = await loadRuns();
  const sorted = runs.toSorted((a, b) => b.startedAt - a.startedAt).slice(0, limit);

  if (sorted.length === 0) {
    console.log("No run history.");
    return;
  }

  console.log("Run History");
  console.log("===========");
  for (const run of sorted) {
    const date = new Date(run.startedAt).toISOString().slice(0, 19);
    const duration = run.completedAt
      ? `${((run.completedAt - run.startedAt) / 1000).toFixed(0)}s`
      : "running";
    console.log(
      `  ${run.id.slice(0, 8)} | ${date} | ${run.status.padEnd(10)} | ${run.trigger.padEnd(6)} | ${duration}`,
    );
    if (run.prsCreated.length > 0) {
      for (const pr of run.prsCreated) {
        console.log(`    PR: ${pr}`);
      }
    }
    if (run.error) {
      console.log(`    Error: ${run.error.slice(0, 100)}`);
    }
  }
}

async function showTipHistory(limit: number, statusFilter?: TipStatus): Promise<void> {
  let tips = await loadTips();

  if (statusFilter) {
    tips = tips.filter((t) => t.status === statusFilter);
  }

  const sorted = tips.toSorted((a, b) => b.discoveredAt - a.discoveredAt).slice(0, limit);

  if (sorted.length === 0) {
    console.log("No tip history" + (statusFilter ? ` for status: ${statusFilter}` : "") + ".");
    return;
  }

  console.log("Tip History" + (statusFilter ? ` (${statusFilter})` : ""));
  console.log("===========");
  for (const tip of sorted) {
    const date = new Date(tip.discoveredAt).toISOString().slice(0, 10);
    console.log(
      `  [${tip.scores.total.toString().padStart(2)}] ${tip.status.padEnd(12)} | ${date} | ${tip.title}`,
    );
    if (tip.implementationPr) {
      console.log(`       PR: ${tip.implementationPr}`);
    }
    if (tip.rejectionReason) {
      console.log(`       Reason: ${tip.rejectionReason.slice(0, 80)}`);
    }
  }
}
