/**
 * Gateway method: orchestration.cancel
 * Cancels an active orchestration.
 */

import { cancelOrchestration } from "../supervisor.js";

type RespondFn = (success: boolean, data?: unknown, error?: unknown) => void;

export async function handleOrchestrationCancel(opts: {
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<void> {
  const orchestrationId =
    typeof opts.params.orchestrationId === "string" ? opts.params.orchestrationId : undefined;

  if (!orchestrationId) {
    opts.respond(false, undefined, { code: -1, message: "orchestrationId required" });
    return;
  }

  const cancelled = await cancelOrchestration(orchestrationId);
  if (!cancelled) {
    opts.respond(false, undefined, { code: -1, message: "orchestration not found" });
    return;
  }

  opts.respond(true, { orchestrationId, cancelled: true });
}
