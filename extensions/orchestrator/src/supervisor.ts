/**
 * Supervisor controller: manages the orchestration lifecycle.
 * Coordinates task creation, handoff, and completion.
 */

import type {
  TaskGraph,
  HandoffStrategy,
  OrchestrationRole,
  OrchestrationConfig,
} from "../../../src/agents/orchestration/types.js";
import { resolveNextHandoff, inferHandoffStrategy } from "./handoff.js";
import { buildRoleSystemPrompt, buildSupervisorSystemPrompt } from "./system-prompts.js";
import { createTaskGraph, updateTaskStatus, cancelGraph, isGraphCompleted } from "./task-graph.js";
import { saveGraph, loadGraph } from "./task-graph.store.js";

export type SupervisorOptions = {
  config: OrchestrationConfig;
  agentId: string;
  sessionKey: string;
};

export type SupervisorState = {
  graph: TaskGraph;
  strategy: HandoffStrategy;
  startedAt: number;
  totalCostUsd: number;
  totalTokens: number;
};

const activeSupervisors = new Map<string, SupervisorState>();

/**
 * Start a new orchestration.
 */
export async function startOrchestration(
  goal: string,
  options: SupervisorOptions,
): Promise<SupervisorState> {
  const graph = createTaskGraph({
    supervisorSessionKey: options.sessionKey,
    rootLabel: goal,
  });

  const strategy = "conditional" as HandoffStrategy;
  const state: SupervisorState = {
    graph,
    strategy,
    startedAt: Date.now(),
    totalCostUsd: 0,
    totalTokens: 0,
  };

  activeSupervisors.set(graph.id, state);
  await saveGraph(graph);
  return state;
}

/**
 * Resume an existing orchestration.
 */
export async function resumeOrchestration(
  orchestrationId: string,
  _options: SupervisorOptions,
): Promise<SupervisorState | null> {
  let state = activeSupervisors.get(orchestrationId);
  if (state) {
    return state;
  }
  const graph = await loadGraph(orchestrationId);
  if (!graph) {
    return null;
  }
  const strategy = inferHandoffStrategy(graph);
  state = {
    graph,
    strategy,
    startedAt: graph.createdAt,
    totalCostUsd: 0,
    totalTokens: 0,
  };
  activeSupervisors.set(orchestrationId, state);
  return state;
}

/**
 * Get the next set of tasks to execute.
 */
export function getNextTasks(
  state: SupervisorState,
  maxConcurrent?: number,
): ReturnType<typeof resolveNextHandoff> {
  return resolveNextHandoff(state.graph, state.strategy, maxConcurrent ?? 3);
}

/**
 * Record a task completion from a specialist agent.
 */
export async function completeTask(
  state: SupervisorState,
  taskId: string,
  result: string,
  success: boolean,
  error?: string,
): Promise<void> {
  updateTaskStatus(state.graph, taskId, success ? "completed" : "failed", result, error);
  await saveGraph(state.graph);
}

/**
 * Record resource usage for tripwire monitoring.
 */
export function recordUsage(state: SupervisorState, costUsd: number, tokens: number): void {
  state.totalCostUsd += costUsd;
  state.totalTokens += tokens;
}

/**
 * Cancel an orchestration.
 */
export async function cancelOrchestration(orchestrationId: string): Promise<boolean> {
  const state = activeSupervisors.get(orchestrationId);
  if (!state) {
    return false;
  }
  cancelGraph(state.graph);
  await saveGraph(state.graph);
  activeSupervisors.delete(orchestrationId);
  return true;
}

/**
 * Check if an orchestration is complete.
 */
export function isOrchestrationComplete(state: SupervisorState): boolean {
  return isGraphCompleted(state.graph);
}

/**
 * Get the supervisor prompt for a goal.
 */
export function getSupervisorPrompt(goal: string, orchestrationId?: string): string {
  return buildSupervisorSystemPrompt({ goal, orchestrationId });
}

/**
 * Get the specialist prompt for a task.
 */
export function getSpecialistPrompt(params: {
  role: OrchestrationRole;
  taskLabel: string;
  instruction: string;
  orchestrationId: string;
  taskId: string;
  context?: string;
}): string {
  return buildRoleSystemPrompt(params);
}

/**
 * Get all active supervisor states.
 */
export function getActiveSupervisors(): Map<string, SupervisorState> {
  return activeSupervisors;
}

/**
 * Get a specific supervisor state.
 */
export function getSupervisorState(orchestrationId: string): SupervisorState | undefined {
  return activeSupervisors.get(orchestrationId);
}
