/**
 * Gateway method: orchestration.list
 * Returns all active orchestrations.
 */

import { getActiveSupervisors } from "../supervisor.js";
import { getAllTasks, getReadyTasks } from "../task-graph.js";

type RespondFn = (success: boolean, data?: unknown, error?: unknown) => void;

export async function handleOrchestrationList(opts: {
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<void> {
  const supervisors = getActiveSupervisors();
  const orchestrations = Array.from(supervisors.entries()).map(([id, state]) => {
    const tasks = getAllTasks(state.graph);
    const ready = getReadyTasks(state.graph);
    return {
      id,
      status: state.graph.status,
      totalTasks: tasks.length,
      readyTasks: ready.length,
      completedTasks: tasks.filter((t) => t.status === "completed").length,
      totalCostUsd: state.totalCostUsd,
      startedAt: state.startedAt,
    };
  });

  opts.respond(true, { orchestrations });
}
