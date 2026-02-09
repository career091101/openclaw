/**
 * delegate_task tool: allows the supervisor to assign a task to a specialist agent.
 * Based on the sessions_spawn pattern from src/agents/tools/sessions-spawn-tool.ts.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { OrchestrationRole } from "../../../../src/agents/orchestration/types.js";
import { buildOrchestratorSessionKey } from "../../../../src/agents/orchestration/types.js";
import { getRoleDefinition } from "../roles.js";
import { createTaskGraph, addTask, getTask } from "../task-graph.js";
import { saveGraph } from "../task-graph.store.js";

const DelegateTaskSchema = Type.Object({
  label: Type.String({ description: "Short description of the task" }),
  role: Type.String({ description: "Role for the task: planner, executor, or critic" }),
  instruction: Type.String({ description: "Detailed instructions for the specialist agent" }),
  dependsOn: Type.Optional(
    Type.Array(Type.String(), {
      description: "Task IDs that must complete before this one starts",
    }),
  ),
  orchestrationId: Type.Optional(
    Type.String({ description: "Existing orchestration ID to add to. Omit to create new." }),
  ),
});

// In-memory store for active orchestrations (also persisted to disk)
const activeGraphs = new Map<string, ReturnType<typeof createTaskGraph>>();

export function createDelegateTaskTool(options: { config?: OpenClawConfig; sessionKey?: string }) {
  return {
    label: "Delegate Task",
    name: "delegate_task",
    description:
      "Delegate a task to a specialist agent (planner, executor, or critic). Creates or extends an orchestration graph.",
    parameters: DelegateTaskSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const label = typeof params.label === "string" ? params.label : "";
      const role = (
        typeof params.role === "string" ? params.role : "executor"
      ) as OrchestrationRole;
      const instruction = typeof params.instruction === "string" ? params.instruction : "";
      const dependsOn = Array.isArray(params.dependsOn)
        ? (params.dependsOn as string[])
        : undefined;
      const orchestrationId =
        typeof params.orchestrationId === "string" ? params.orchestrationId : undefined;

      if (!label || !instruction) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "label and instruction are required", ok: false }),
            },
          ],
        };
      }

      const roleDef = getRoleDefinition(role);
      if (!roleDef) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `unknown role: ${role}`, ok: false }),
            },
          ],
        };
      }

      try {
        let graph = orchestrationId ? activeGraphs.get(orchestrationId) : undefined;
        if (!graph) {
          graph = createTaskGraph({
            supervisorSessionKey: options.sessionKey ?? "unknown",
            rootLabel: label,
          });
          activeGraphs.set(graph.id, graph);
          // The root task was already created; update it if this is a fresh graph
          const root = getTask(graph, graph.rootTaskId)!;
          if (root) {
            root.role = role;
            root.label = label;
          }
        } else {
          // Add a new task to the existing graph
          addTask(graph, { label, role, dependsOn });
        }

        // Build session key for the specialist agent
        const agentId = options.sessionKey?.split(":")?.[1] ?? "default";
        const taskId = Array.from(graph.nodes.keys()).pop()!;
        const sessionKey = buildOrchestratorSessionKey({
          agentId,
          orchestrationId: graph.id,
          role,
          taskId,
        });

        // Persist to disk
        await saveGraph(graph);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                orchestrationId: graph.id,
                taskId,
                role,
                sessionKey,
                label,
                instruction: instruction.slice(0, 200) + (instruction.length > 200 ? "..." : ""),
                toolGroups: roleDef.toolGroups,
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message, ok: false }) }],
        };
      }
    },
  };
}

/** Get an active graph by ID (for use by other tools). */
export function getActiveGraph(orchestrationId: string) {
  return activeGraphs.get(orchestrationId);
}

/** Get all active graphs (for listing). */
export function getAllActiveGraphs() {
  return Array.from(activeGraphs.values());
}
