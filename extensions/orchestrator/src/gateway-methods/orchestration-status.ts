/**
 * Gateway method: orchestration.status
 * Returns the status of a specific orchestration.
 */

import { getSupervisorState } from "../supervisor.js";
import { getAllTasks, getReadyTasks } from "../task-graph.js";

type RespondFn = (success: boolean, data?: unknown, error?: unknown) => void;

export async function handleOrchestrationStatus(opts: {
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<void> {
  const orchestrationId =
    typeof opts.params.orchestrationId === "string" ? opts.params.orchestrationId : undefined;

  if (!orchestrationId) {
    opts.respond(false, undefined, { code: -1, message: "orchestrationId required" });
    return;
  }

  const state = getSupervisorState(orchestrationId);
  if (!state) {
    opts.respond(false, undefined, { code: -1, message: "orchestration not found" });
    return;
  }

  const tasks = getAllTasks(state.graph);
  const ready = getReadyTasks(state.graph);

  opts.respond(true, {
    orchestrationId: state.graph.id,
    status: state.graph.status,
    strategy: state.strategy,
    totalTasks: tasks.length,
    readyTasks: ready.length,
    completedTasks: tasks.filter((t) => t.status === "completed").length,
    failedTasks: tasks.filter((t) => t.status === "failed").length,
    totalCostUsd: state.totalCostUsd,
    totalTokens: state.totalTokens,
    startedAt: state.startedAt,
    tasks: tasks.map((t) => ({
      id: t.id,
      label: t.label,
      role: t.role,
      status: t.status,
      retryCount: t.retryCount,
    })),
  });
}
