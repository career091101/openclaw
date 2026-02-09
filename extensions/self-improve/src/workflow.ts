/**
 * Self-improvement workflow: orchestrator-integrated main loop.
 * Uses TaskGraph DAG for: Research → Implement → Review.
 */

import { randomUUID } from "node:crypto";
import type { TipRecord, RunRecord } from "./types.js";
import { PLANNER_PROMPT, EXECUTOR_PROMPT, CRITIC_PROMPT } from "./prompts.js";
import { loadTips, saveRun, updateRun } from "./store.js";

export type WorkflowOptions = {
  trigger: "cron" | "manual";
  dryRun?: boolean;
  tipId?: string;
  maxTips?: number;
  cwd: string;
};

export type WorkflowResult = {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  tipsResearched: number;
  tipsImplemented: number;
  prsCreated: string[];
  error?: string;
};

/** Tripwire configuration for the self-improve loop. */
const TRIPWIRE_CONFIG = {
  maxCostUsd: 2.0,
  maxTokens: 500_000,
  maxDurationMinutes: 30,
};

/** Maximum retry attempts for test gate failures. */
const MAX_RETRIES = 2;

/**
 * Build the task DAG for a self-improve run.
 * Returns the planned task structure (not executed here - orchestrator handles execution).
 */
export function buildTaskDag(options: WorkflowOptions): {
  phases: Array<{
    role: "planner" | "executor" | "critic";
    label: string;
    prompt: string;
    dependsOn: string[];
  }>;
  tripwire: typeof TRIPWIRE_CONFIG;
  maxRetries: number;
} {
  const researchTaskId = randomUUID();
  const implementTaskId = randomUUID();
  const reviewTaskId = randomUUID();

  const phases = [
    {
      id: researchTaskId,
      role: "planner" as const,
      label: "Research & Evaluate autonomy tips",
      prompt: PLANNER_PROMPT,
      dependsOn: [] as string[],
    },
  ];

  if (!options.dryRun) {
    phases.push(
      {
        id: implementTaskId,
        role: "executor" as const,
        label: "Implement highest-scoring tip",
        prompt: EXECUTOR_PROMPT,
        dependsOn: [researchTaskId],
      },
      {
        id: reviewTaskId,
        role: "critic" as const,
        label: "Review implementation & create PR",
        prompt: CRITIC_PROMPT,
        dependsOn: [implementTaskId],
      },
    );
  }

  return {
    phases,
    tripwire: TRIPWIRE_CONFIG,
    maxRetries: MAX_RETRIES,
  };
}

/** Create a new run record and persist it. */
export async function startRun(options: WorkflowOptions): Promise<RunRecord> {
  const run: RunRecord = {
    id: randomUUID(),
    startedAt: Date.now(),
    trigger: options.trigger,
    status: "running",
    tipsResearched: 0,
    tipsImplemented: 0,
    prsCreated: [],
    totalTokens: 0,
    totalCostUsd: 0,
  };
  await saveRun(run);
  return run;
}

/** Complete a run with results. */
export async function completeRun(
  runId: string,
  result: Omit<WorkflowResult, "runId">,
): Promise<void> {
  await updateRun(runId, {
    status: result.status,
    completedAt: Date.now(),
    tipsResearched: result.tipsResearched,
    tipsImplemented: result.tipsImplemented,
    prsCreated: result.prsCreated,
    error: result.error,
  });
}

/** Get the best candidate tip to implement. */
export async function getBestCandidate(tipId?: string): Promise<TipRecord | null> {
  const tips = await loadTips();

  if (tipId) {
    return tips.find((t) => t.id === tipId && t.status === "evaluated") ?? null;
  }

  // Find highest-scoring evaluated tip
  const candidates = tips
    .filter((t) => t.status === "evaluated")
    .toSorted((a, b) => b.scores.total - a.scores.total);

  return candidates[0] ?? null;
}

/** Build the agent message for a cron isolated agent run. */
export function buildImprovementMessage(opts: {
  dryRun?: boolean;
  tipId?: string;
  maxTips?: number;
  existingTipTitles?: string[];
}): string {
  const parts: string[] = [];

  if (opts.dryRun) {
    parts.push("MODE: dry-run (research and evaluate only, do not implement)");
  }
  if (opts.tipId) {
    parts.push(`TARGET TIP: ${opts.tipId}`);
  }
  parts.push(`MAX TIPS TO RESEARCH: ${opts.maxTips ?? 10}`);

  if (opts.existingTipTitles && opts.existingTipTitles.length > 0) {
    parts.push("\nALREADY DISCOVERED TIPS (avoid duplicates):");
    for (const title of opts.existingTipTitles) {
      parts.push(`  - ${title}`);
    }
  }

  parts.push("\nExecute the self-improvement workflow now.");
  return parts.join("\n");
}
