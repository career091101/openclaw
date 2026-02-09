/**
 * submit_result tool: specialist agents use this to report task completion.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { updateTaskStatus } from "../task-graph.js";
import { saveGraph } from "../task-graph.store.js";
import { getActiveGraph } from "./delegate-task.js";
import { reflectOnTaskResult } from "../../../agent-autonomy/src/task-reflection.js";

const SubmitResultSchema = Type.Object({
  orchestrationId: Type.String({ description: "Orchestration ID" }),
  taskId: Type.String({ description: "Task ID to mark as completed" }),
  result: Type.String({ description: "Summary of the completed work" }),
  success: Type.Optional(
    Type.Boolean({ description: "Whether the task succeeded (default: true)" }),
  ),
  error: Type.Optional(Type.String({ description: "Error message if the task failed" })),
});

export function createSubmitResultTool(_options: { config?: OpenClawConfig; sessionKey?: string }) {
  return {
    label: "Submit Result",
    name: "submit_result",
    description:
      "Submit the result of a completed task. Call this when done with an assigned task.",
    parameters: SubmitResultSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const orchestrationId =
        typeof params.orchestrationId === "string" ? params.orchestrationId : "";
      const taskId = typeof params.taskId === "string" ? params.taskId : "";
      const result = typeof params.result === "string" ? params.result : "";
      const success = params.success !== false;
      const error = typeof params.error === "string" ? params.error : undefined;

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

        // Get task node to access its label for reflection
        const taskNode = graph.nodes.get(taskId);
        if (!taskNode) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `task not found: ${taskId}`, ok: false }),
              },
            ],
          };
        }

        // Perform self-reflection on the task result
        const reflectionResult = reflectOnTaskResult({
          taskDescription: taskNode.label,
          result,
          success,
          error,
        });

        let finalResult = result;
        let warningMessage = "";

        // If reflection detects issues, append them to the result
        if (!reflectionResult.valid && reflectionResult.needsRevision) {
          warningMessage = `\n\n⚠️  Self-reflection detected potential issues:\n${reflectionResult.issues.join("\n")}\nSuggestions:\n${(reflectionResult.suggestions ?? []).join("\n")}`;
          finalResult = result + warningMessage;
        } else if (reflectionResult.issues.length > 0) {
          // Minor issues that don't require revision
          warningMessage = `\n\nℹ️  Quality notes:\n${reflectionResult.issues.join("\n")}`;
          finalResult = result + warningMessage;
        }

        updateTaskStatus(graph, taskId, success ? "completed" : "failed", finalResult, error);
        await saveGraph(graph);

        const response: Record<string, unknown> = {
          ok: true,
          orchestrationId,
          taskId,
          status: success ? "completed" : "failed",
          graphStatus: graph.status,
        };

        // Include reflection feedback in the response
        if (reflectionResult.issues.length > 0) {
          response.reflection = {
            valid: reflectionResult.valid,
            confidence: reflectionResult.confidence,
            issues: reflectionResult.issues,
            suggestions: reflectionResult.suggestions,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
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
