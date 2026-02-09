/**
 * Handoff strategies for orchestration task execution.
 * Determines the order and parallelism of task execution.
 */

import type {
  TaskGraph,
  HandoffStrategy,
  TaskNode,
} from "../../../src/agents/orchestration/types.js";
import { getReadyTasks, getAllTasks } from "./task-graph.js";

export type HandoffDecision = {
  strategy: HandoffStrategy;
  tasksToStart: TaskNode[];
  reason: string;
};

/**
 * Determine which tasks to start next based on the handoff strategy.
 */
export function resolveNextHandoff(
  graph: TaskGraph,
  strategy: HandoffStrategy,
  maxConcurrent: number,
): HandoffDecision {
  const ready = getReadyTasks(graph);

  if (ready.length === 0) {
    return { strategy, tasksToStart: [], reason: "no ready tasks" };
  }

  switch (strategy) {
    case "sequential": {
      // Start only the first ready task
      return {
        strategy: "sequential",
        tasksToStart: [ready[0]],
        reason: `starting next task: ${ready[0].label}`,
      };
    }

    case "parallel": {
      // Start all independent ready tasks up to maxConcurrent
      const toStart = ready.slice(0, maxConcurrent);
      return {
        strategy: "parallel",
        tasksToStart: toStart,
        reason: `starting ${toStart.length} parallel tasks`,
      };
    }

    case "conditional": {
      // Check the last completed task to decide what to start next
      const allTasks = getAllTasks(graph);
      const lastCompleted = allTasks
        .filter((t) => t.status === "completed")
        .toSorted((a, b) => b.updatedAt - a.updatedAt)[0];

      if (!lastCompleted) {
        // No completed tasks yet — start the first ready task
        return {
          strategy: "conditional",
          tasksToStart: [ready[0]],
          reason: "no completed tasks yet, starting first ready task",
        };
      }

      // If the last completed task was a planner, start all executor tasks
      if (lastCompleted.role === "planner") {
        const executorTasks = ready.filter((t) => t.role === "executor");
        const toStart =
          executorTasks.length > 0 ? executorTasks.slice(0, maxConcurrent) : [ready[0]];
        return {
          strategy: "conditional",
          tasksToStart: toStart,
          reason: "planner completed, starting executor tasks",
        };
      }

      // If the last completed task was an executor, check for critic tasks
      if (lastCompleted.role === "executor") {
        const criticTasks = ready.filter((t) => t.role === "critic");
        if (criticTasks.length > 0) {
          return {
            strategy: "conditional",
            tasksToStart: criticTasks.slice(0, maxConcurrent),
            reason: "executor completed, starting review tasks",
          };
        }
      }

      // Default: start the first ready task
      return {
        strategy: "conditional",
        tasksToStart: [ready[0]],
        reason: "conditional fallback: starting next ready task",
      };
    }

    default:
      return { strategy, tasksToStart: [], reason: `unknown strategy: ${strategy as string}` };
  }
}

/**
 * Determine the best handoff strategy based on the graph structure.
 */
export function inferHandoffStrategy(graph: TaskGraph): HandoffStrategy {
  const tasks = getAllTasks(graph);

  // If all tasks have no dependencies (flat), use parallel
  const hasNoDeps = tasks.every((t) => t.dependsOn.length === 0 || t.id === graph.rootTaskId);
  if (hasNoDeps) {
    return "parallel";
  }

  // If there's a clear linear chain, use sequential
  const maxDependents = Math.max(
    ...tasks.map((t) => tasks.filter((other) => other.dependsOn.includes(t.id)).length),
  );
  if (maxDependents <= 1) {
    return "sequential";
  }

  // Mixed graph — use conditional
  return "conditional";
}
