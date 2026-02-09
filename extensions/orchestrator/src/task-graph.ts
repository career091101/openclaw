/**
 * TaskGraph: manages a DAG of tasks for orchestrated execution.
 * Follows the SubagentRunRecord pattern with in-memory state + disk persistence.
 */

import { randomUUID } from "node:crypto";
import type {
  TaskNode,
  TaskGraph,
  TaskStatus,
  OrchestrationRole,
} from "../../../src/agents/orchestration/types.js";

export type CreateTaskParams = {
  label: string;
  role: OrchestrationRole;
  dependsOn?: string[];
};

/** Create a new task graph. */
export function createTaskGraph(params: {
  supervisorSessionKey: string;
  rootLabel: string;
}): TaskGraph {
  const id = randomUUID();
  const rootTaskId = randomUUID();
  const rootNode: TaskNode = {
    id: rootTaskId,
    label: params.rootLabel,
    role: "planner",
    status: "pending",
    dependsOn: [],
    retryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const nodes = new Map<string, TaskNode>();
  nodes.set(rootTaskId, rootNode);
  return {
    id,
    rootTaskId,
    nodes,
    supervisorSessionKey: params.supervisorSessionKey,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Add a task node to the graph. */
export function addTask(graph: TaskGraph, params: CreateTaskParams): TaskNode {
  const id = randomUUID();
  const node: TaskNode = {
    id,
    label: params.label,
    role: params.role,
    status: "pending",
    dependsOn: params.dependsOn ?? [],
    retryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Validate dependencies exist
  for (const depId of node.dependsOn) {
    if (!graph.nodes.has(depId)) {
      throw new Error(`dependency not found: ${depId}`);
    }
  }
  graph.nodes.set(id, node);
  graph.updatedAt = Date.now();
  return node;
}

/** Update a task's status. */
export function updateTaskStatus(
  graph: TaskGraph,
  taskId: string,
  status: TaskStatus,
  result?: string,
  error?: string,
): void {
  const node = graph.nodes.get(taskId);
  if (!node) {
    throw new Error(`task not found: ${taskId}`);
  }
  node.status = status;
  node.updatedAt = Date.now();
  if (result !== undefined) {
    node.result = result;
  }
  if (error !== undefined) {
    node.error = error;
  }
  if (status === "failed") {
    node.retryCount += 1;
  }
  graph.updatedAt = Date.now();
  // Update graph status if all tasks are done
  updateGraphStatus(graph);
}

/** Set the session key for a task (when a subagent is spawned). */
export function setTaskSessionKey(graph: TaskGraph, taskId: string, sessionKey: string): void {
  const node = graph.nodes.get(taskId);
  if (!node) {
    throw new Error(`task not found: ${taskId}`);
  }
  node.sessionKey = sessionKey;
  node.updatedAt = Date.now();
}

/** Get tasks that are ready to run (all dependencies completed). */
export function getReadyTasks(graph: TaskGraph): TaskNode[] {
  const ready: TaskNode[] = [];
  for (const node of graph.nodes.values()) {
    if (node.status !== "pending") {
      continue;
    }
    const allDepsCompleted = node.dependsOn.every((depId) => {
      const dep = graph.nodes.get(depId);
      return dep?.status === "completed";
    });
    if (allDepsCompleted) {
      ready.push(node);
    }
  }
  return ready;
}

/** Get all tasks for a specific role. */
export function getTasksByRole(graph: TaskGraph, role: OrchestrationRole): TaskNode[] {
  return Array.from(graph.nodes.values()).filter((n) => n.role === role);
}

/** Get a specific task. */
export function getTask(graph: TaskGraph, taskId: string): TaskNode | undefined {
  return graph.nodes.get(taskId);
}

/** Get all tasks in the graph. */
export function getAllTasks(graph: TaskGraph): TaskNode[] {
  return Array.from(graph.nodes.values());
}

/** Check if the graph has any failed tasks. */
export function hasFailedTasks(graph: TaskGraph): boolean {
  return Array.from(graph.nodes.values()).some((n) => n.status === "failed");
}

/** Check if all tasks in the graph are completed. */
export function isGraphCompleted(graph: TaskGraph): boolean {
  return Array.from(graph.nodes.values()).every(
    (n) => n.status === "completed" || n.status === "cancelled",
  );
}

/** Cancel all pending/running tasks. */
export function cancelGraph(graph: TaskGraph): void {
  for (const node of graph.nodes.values()) {
    if (node.status === "pending" || node.status === "running") {
      node.status = "cancelled";
      node.updatedAt = Date.now();
    }
  }
  graph.status = "cancelled";
  graph.updatedAt = Date.now();
}

function updateGraphStatus(graph: TaskGraph): void {
  if (graph.status !== "active") {
    return;
  }
  if (isGraphCompleted(graph)) {
    graph.status = "completed";
  } else if (hasFailedTasks(graph)) {
    // Check if any ready tasks remain — if not, the graph is stuck/failed
    const ready = getReadyTasks(graph);
    const running = Array.from(graph.nodes.values()).filter((n) => n.status === "running");
    if (ready.length === 0 && running.length === 0) {
      graph.status = "failed";
    }
  }
}

/** Serialize a graph for disk persistence. */
export function serializeGraph(graph: TaskGraph): string {
  const obj = {
    ...graph,
    nodes: Object.fromEntries(graph.nodes),
  };
  return JSON.stringify(obj, null, 2);
}

/** Deserialize a graph from disk. */
export function deserializeGraph(json: string): TaskGraph {
  const obj = JSON.parse(json);
  const nodes = new Map<string, TaskNode>(Object.entries(obj.nodes));
  return {
    ...obj,
    nodes,
  };
}
