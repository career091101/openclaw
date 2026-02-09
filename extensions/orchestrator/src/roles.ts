/**
 * Specialist agent role definitions for the orchestrator.
 * Each role has a purpose, tool policy, and default autonomy level.
 */

import type { OrchestrationRole, AutonomyLevel } from "../../../src/agents/orchestration/types.js";

export type RoleDefinition = {
  role: OrchestrationRole;
  label: string;
  purpose: string;
  toolGroups: string[];
  readOnlyTools: string[];
  defaultAutonomyLevel: AutonomyLevel;
};

export const ROLE_DEFINITIONS: Record<OrchestrationRole, RoleDefinition> = {
  planner: {
    role: "planner",
    label: "Planner",
    purpose: "Task decomposition, dependency graph construction, and strategy formulation",
    toolGroups: ["group:fs", "group:web", "group:memory"],
    readOnlyTools: ["read", "memory_search", "memory_get", "web_search", "web_fetch"],
    defaultAutonomyLevel: 2,
  },
  executor: {
    role: "executor",
    label: "Executor",
    purpose: "Task execution with full access to tools (subject to autonomy level restrictions)",
    toolGroups: ["group:fs", "group:runtime", "group:web", "group:memory", "group:sessions"],
    readOnlyTools: [],
    defaultAutonomyLevel: 3,
  },
  critic: {
    role: "critic",
    label: "Critic / QA",
    purpose: "Result verification, quality assessment, and improvement suggestions",
    toolGroups: ["group:fs", "group:memory"],
    readOnlyTools: ["read", "memory_search", "memory_get"],
    defaultAutonomyLevel: 1,
  },
};

/** Get the role definition for a given role. */
export function getRoleDefinition(role: OrchestrationRole): RoleDefinition {
  return ROLE_DEFINITIONS[role];
}

/** Get all available role names. */
export function getAvailableRoles(): OrchestrationRole[] {
  return Object.keys(ROLE_DEFINITIONS) as OrchestrationRole[];
}

/** Resolve the effective autonomy level for a role (config override or default). */
export function resolveRoleAutonomyLevel(
  role: OrchestrationRole,
  configOverride?: AutonomyLevel,
): AutonomyLevel {
  if (configOverride != null) {
    return configOverride;
  }
  return ROLE_DEFINITIONS[role].defaultAutonomyLevel;
}
