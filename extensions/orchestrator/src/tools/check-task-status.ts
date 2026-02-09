/**
 * check_task_status tool: query the status of a task or orchestration.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { getTask, getAllTasks, getReadyTasks } from "../task-graph.js";
import { getActiveGraph, getAllActiveGraphs } from "./delegate-task.js";

const CheckTaskStatusSchema = Type.Object({
  orchestrationId: Type.Optional(
    Type.String({ description: "Orchestration ID. Omit to list all active orchestrations." }),
  ),
  taskId: Type.Optional(
    Type.String({ description: "Specific task ID to query. Omit for full orchestration summary." }),
  ),
});

export function createCheckTaskStatusTool(_options: {
  config?: OpenClawConfig;
  sessionKey?: string;
}) {
  return {
    label: "Check Task Status",
    name: "check_task_status",
    description:
      "Query the status of orchestration tasks. Without parameters lists all active orchestrations.",
    parameters: CheckTaskStatusSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const orchestrationId =
        typeof params.orchestrationId === "string" ? params.orchestrationId : undefined;
      const taskId = typeof params.taskId === "string" ? params.taskId : undefined;

      try {
        // List all active orchestrations
        if (!orchestrationId) {
          const graphs = getAllActiveGraphs();
          const summary = graphs.map((g) => ({
            id: g.id,
            status: g.status,
            totalTasks: g.nodes.size,
            readyTasks: getReadyTasks(g).length,
            createdAt: g.createdAt,
          }));
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ orchestrations: summary, ok: true }),
              },
            ],
          };
        }

        const graph = getActiveGraph(orchestrationId);
        if (!graph) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `orchestration not found: ${orchestrationId}`,
                  ok: false,
                }),
              },
            ],
          };
        }

        // Query specific task
        if (taskId) {
          const task = getTask(graph, taskId);
          if (!task) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ error: `task not found: ${taskId}`, ok: false }),
                },
              ],
            };
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ task, ok: true }) }],
          };
        }

        // Full orchestration summary
        const tasks = getAllTasks(graph);
        const ready = getReadyTasks(graph);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                orchestrationId: graph.id,
                status: graph.status,
                totalTasks: tasks.length,
                readyTasks: ready.map((t) => ({ id: t.id, label: t.label, role: t.role })),
                tasks: tasks.map((t) => ({
                  id: t.id,
                  label: t.label,
                  role: t.role,
                  status: t.status,
                  dependsOn: t.dependsOn,
                  retryCount: t.retryCount,
                })),
                ok: true,
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
