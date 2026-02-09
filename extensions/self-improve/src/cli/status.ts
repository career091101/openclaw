/**
 * CLI command: openclaw improve status
 * Shows the current status of the self-improvement system.
 */

import { loadTips, loadRuns } from "../store.js";

export async function handleImproveStatus(): Promise<void> {
  const tips = await loadTips();
  const runs = await loadRuns();

  const statusCounts: Record<string, number> = {};
  for (const tip of tips) {
    statusCounts[tip.status] = (statusCounts[tip.status] ?? 0) + 1;
  }

  console.log("Self-Improve Status");
  console.log("===================");
  console.log(`Total tips: ${tips.length}`);

  if (Object.keys(statusCounts).length > 0) {
    console.log("\nTip status breakdown:");
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  ${status}: ${count}`);
    }
  }

  // Show top evaluated tips
  const evaluated = tips
    .filter((t) => t.status === "evaluated")
    .toSorted((a, b) => b.scores.total - a.scores.total)
    .slice(0, 5);

  if (evaluated.length > 0) {
    console.log("\nTop evaluated tips:");
    for (const tip of evaluated) {
      console.log(`  [${tip.scores.total}] ${tip.title}`);
    }
  }

  // Show recent runs
  const recentRuns = runs.toSorted((a, b) => b.startedAt - a.startedAt).slice(0, 5);

  if (recentRuns.length > 0) {
    console.log("\nRecent runs:");
    for (const run of recentRuns) {
      const date = new Date(run.startedAt).toISOString().slice(0, 19);
      console.log(
        `  [${run.status}] ${date} - ${run.trigger} (${run.tipsResearched} researched, ${run.tipsImplemented} implemented)`,
      );
    }
  } else {
    console.log("\nNo runs yet.");
  }
}
