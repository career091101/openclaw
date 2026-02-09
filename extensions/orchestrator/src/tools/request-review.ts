/**
 * request_review tool: request a critic/QA agent to review work.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { buildOrchestratorSessionKey } from "../../../../src/agents/orchestration/types.js";
import { addTask, getTask } from "../task-graph.js";
import { saveGraph } from "../task-graph.store.js";
import { getActiveGraph } from "./delegate-task.js";

const RequestReviewSchema = Type.Object({
  orchestrationId: Type.String({ description: "Orchestration ID" }),
  taskId: Type.String({ description: "Task ID whose output should be reviewed" }),
  reviewInstructions: Type.Optional(
    Type.String({ description: "Specific aspects to focus the review on" }),
  ),
});

export function createRequestReviewTool(options: { config?: OpenClawConfig; sessionKey?: string }) {
  return {
    label: "Request Review",
    name: "request_review",
    description: "Request a critic/QA agent to review the output of a completed task.",
    parameters: RequestReviewSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const orchestrationId =
        typeof params.orchestrationId === "string" ? params.orchestrationId : "";
      const taskId = typeof params.taskId === "string" ? params.taskId : "";
      const reviewInstructions =
        typeof params.reviewInstructions === "string"
          ? params.reviewInstructions
          : "Review the output for correctness and completeness.";

      if (!orchestrationId || !taskId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "orchestrationId and taskId are required", ok: false }),
            },
          ],
        };
      }

      try {
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

        const targetTask = getTask(graph, taskId);
        if (!targetTask) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `task not found: ${taskId}`, ok: false }),
              },
            ],
          };
        }

        if (targetTask.status !== "completed") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `task is not completed (status: ${targetTask.status})`,
                  ok: false,
                }),
              },
            ],
          };
        }

        // Create a review task depending on the completed task
        const reviewTask = addTask(graph, {
          label: `Review: ${targetTask.label}`,
          role: "critic",
          dependsOn: [taskId],
        });

        const agentId = options.sessionKey?.split(":")?.[1] ?? "default";
        const sessionKey = buildOrchestratorSessionKey({
          agentId,
          orchestrationId: graph.id,
          role: "critic",
          taskId: reviewTask.id,
        });

        await saveGraph(graph);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                orchestrationId,
                reviewTaskId: reviewTask.id,
                reviewOf: taskId,
                sessionKey,
                instructions: reviewInstructions.slice(0, 200),
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
