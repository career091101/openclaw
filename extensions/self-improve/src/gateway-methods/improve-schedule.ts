/**
 * Gateway method: improve.schedule
 * Manages the recurring cron schedule for automated self-improvement runs.
 */

import { buildAgentMessage } from "../context-bridge.js";

type RespondFn = (success: boolean, data?: unknown, error?: unknown) => void;

/** Default cron expression: every Sunday at 3:00 UTC */
const DEFAULT_CRON = "0 3 * * 0";
const JOB_NAME = "self-improve-auto";

type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr?: string; tz?: string; [key: string]: unknown };
  state: Record<string, unknown>;
  [key: string]: unknown;
};

export async function handleImproveSchedule(opts: {
  params: Record<string, unknown>;
  respond: RespondFn;
  context: {
    cron: {
      add: (job: Record<string, unknown>) => Promise<CronJob>;
      update: (id: string, patch: Record<string, unknown>) => Promise<CronJob>;
      remove: (id: string) => Promise<{ removed: boolean }>;
      list: (opts?: { includeDisabled?: boolean }) => Promise<CronJob[]>;
    };
    [key: string]: unknown;
  };
}): Promise<void> {
  const action = typeof opts.params.action === "string" ? opts.params.action : "status";
  const cronExpr = typeof opts.params.cronExpr === "string" ? opts.params.cronExpr : undefined;

  try {
    // Find existing self-improve cron job
    const jobs = await opts.context.cron.list({ includeDisabled: true });
    const existing = jobs.find((j) => j.name === JOB_NAME);

    switch (action) {
      case "enable": {
        const expr = cronExpr ?? DEFAULT_CRON;
        if (existing) {
          const updated = await opts.context.cron.update(existing.id, {
            enabled: true,
            schedule: { kind: "cron", expr, tz: "UTC" },
          });
          opts.respond(true, { action: "enabled", jobId: updated.id, schedule: expr });
        } else {
          const agentMessage = buildAgentMessage({ existingTipTitles: [], maxTips: 10 });
          const job = await opts.context.cron.add({
            name: JOB_NAME,
            enabled: true,
            schedule: { kind: "cron", expr, tz: "UTC" },
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
          opts.respond(true, { action: "enabled", jobId: job.id, schedule: expr });
        }
        break;
      }
      case "disable": {
        if (!existing) {
          opts.respond(true, { action: "disable", message: "No schedule configured" });
          return;
        }
        await opts.context.cron.update(existing.id, { enabled: false });
        opts.respond(true, { action: "disabled", jobId: existing.id });
        break;
      }
      case "remove": {
        if (!existing) {
          opts.respond(true, { action: "remove", message: "No schedule configured" });
          return;
        }
        await opts.context.cron.remove(existing.id);
        opts.respond(true, { action: "removed", jobId: existing.id });
        break;
      }
      case "status":
      default: {
        if (!existing) {
          opts.respond(true, { configured: false, message: "No schedule configured" });
          return;
        }
        opts.respond(true, {
          configured: true,
          enabled: existing.enabled,
          jobId: existing.id,
          schedule: existing.schedule,
          state: existing.state,
        });
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.respond(false, undefined, { code: -1, message });
  }
}
