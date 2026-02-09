/** Shared type definitions for the orchestration subsystem. */

export type OrchestrationRole = "planner" | "executor" | "critic";

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type TaskNode = {
  id: string;
  label: string;
  role: OrchestrationRole;
  status: TaskStatus;
  dependsOn: string[];
  result?: string;
  error?: string;
  retryCount: number;
  sessionKey?: string;
  createdAt: number;
  updatedAt: number;
};

export type TaskGraph = {
  id: string;
  rootTaskId: string;
  nodes: Map<string, TaskNode>;
  supervisorSessionKey: string;
  status: "active" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
};

export type HandoffStrategy = "sequential" | "parallel" | "conditional";

export type OrchestrationConfig = {
  enabled: boolean;
  autonomyLevel: AutonomyLevel;
  maxConcurrentTasks: number;
  tripwire?: {
    maxCostUsd?: number;
    maxTokens?: number;
    maxDurationMinutes?: number;
  };
  roles?: {
    planner?: { model?: string; autonomyLevel?: AutonomyLevel };
    executor?: { model?: string; autonomyLevel?: AutonomyLevel };
    critic?: { model?: string; autonomyLevel?: AutonomyLevel };
  };
  audit?: {
    enabled: boolean;
    retentionDays: number;
  };
};

export type OrchestrationEvent = {
  orchestrationId: string;
  taskId?: string;
  role?: OrchestrationRole;
  type:
    | "task.created"
    | "task.started"
    | "task.completed"
    | "task.failed"
    | "tripwire.triggered"
    | "orchestration.completed";
  data?: Record<string, unknown>;
  timestamp: number;
};

/** Session key format for orchestrator sub-agents. */
export function buildOrchestratorSessionKey(params: {
  agentId: string;
  orchestrationId: string;
  role: OrchestrationRole;
  taskId: string;
}): string {
  return `agent:${params.agentId}:orchestrator:${params.orchestrationId}:${params.role}:${params.taskId}`;
}

/** Parse an orchestrator session key. */
export function parseOrchestratorSessionKey(sessionKey: string): {
  agentId: string;
  orchestrationId: string;
  role: OrchestrationRole;
  taskId: string;
} | null {
  const parts = sessionKey.split(":");
  if (parts.length < 6 || parts[0] !== "agent" || parts[2] !== "orchestrator") {
    return null;
  }
  return {
    agentId: parts[1],
    orchestrationId: parts[3],
    role: parts[4] as OrchestrationRole,
    taskId: parts[5],
  };
}
