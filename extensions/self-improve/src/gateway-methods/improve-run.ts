/**
 * Gateway method: improve.run
 * Triggers a self-improvement run via cron isolated agent.
 */

import { loadTips } from "../store.js";
import { buildAgentMessage } from "../context-bridge.js";

type RespondFn = (success: boolean, data?: unknown, error?: unknown) => void;

type CronJobCreate = {
  name: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  schedule: { kind: "at"; atMs: number };
  sessionTarget: "isolated";
  wakeMode: "now";
  payload: {
    kind: "agentTurn";
    message: string;
    timeoutSeconds?: number;
  };
  isolation?: {
    postToMainPrefix?: string;
    postToMainMode?: "summary" | "full";
  };
};

type CronJob = CronJobCreate & { id: string };

export async function handleImproveRun(opts: {
  params: Record<string, unknown>;
  respond: RespondFn;
  context: {
    cron: {
      add: (job: CronJobCreate) => Promise<CronJob>;
    };
    [key: string]: unknown;
  };
}): Promise<void> {
  try {
    const dryRun = opts.params.dryRun === true;
    const tipId = typeof opts.params.tipId === "string" ? opts.params.tipId : undefined;
    const maxTips = typeof opts.params.maxTips === "number" ? opts.params.maxTips : 10;

    // Load existing tips for context
    const tips = await loadTips();
    const existingTipTitles = tips.map((t) => t.title);

    // Build agent message
    const agentMessage = buildAgentMessage({
      dryRun,
      tipId,
      maxTips,
      existingTipTitles,
    });

    // Create one-shot isolated agent job
    const job = await opts.context.cron.add({
      name: "self-improve-run",
      enabled: true,
      deleteAfterRun: true,
      schedule: { kind: "at", atMs: Date.now() + 500 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: agentMessage,
        timeoutSeconds: 1800,
      },
      isolation: {
        postToMainPrefix: "Self-Improve",
        postToMainMode: "summary",
      },
    });

    opts.respond(true, {
      triggered: true,
      jobId: job.id,
      dryRun,
      tipId,
      maxTips,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.respond(false, undefined, { code: -1, message });
  }
}
