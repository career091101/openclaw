/**
 * handoff_to_agent tool: allows agents to explicitly hand off tasks to specialized peers.
 * Inspired by OpenAI's Swarm framework for agent delegation.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { HandoffStrategy } from "./types.js";
import { executeHandoff } from "./executor.js";
import { findAgent, getAgent, listAgents } from "./registry.js";

const HandoffToAgentSchema = Type.Object({
  targetAgentId: Type.Optional(
    Type.String({
      description: "ID of the specialist agent to hand off to (optional if using autoSelect)",
    }),
  ),
  autoSelect: Type.Optional(
    Type.Boolean({
      description: "Automatically select the best agent based on the task description",
    }),
  ),
  task: Type.String({
    description: "Description of the task for the specialist agent",
  }),
  reason: Type.String({
    description: "Why you are handing off this task (for context)",
  }),
  sharedState: Type.Optional(
    Type.Record(Type.String(), Type.Any(), {
      description: "State to share with the target agent (JSON object)",
    }),
  ),
  strategy: Type.Optional(
    Type.Union(
      [Type.Literal("immediate"), Type.Literal("wait-for-completion"), Type.Literal("async")],
      {
        description:
          "Handoff strategy: immediate (transfer control), wait-for-completion (wait for result), or async (fire and forget)",
      },
    ),
  ),
});

export function createHandoffToAgentTool(options: {
  config?: OpenClawConfig;
  sessionKey?: string;
}) {
  return {
    label: "Handoff to Agent",
    name: "handoff_to_agent",
    description:
      "Hand off a task to a specialized peer agent. Use this when you need specific expertise " +
      "(e.g., code review, research, data analysis). Available agents: code-specialist, " +
      "research-specialist, data-specialist, writing-specialist, qa-specialist. " +
      "Use autoSelect=true to automatically pick the best agent for the task.",
    parameters: HandoffToAgentSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const targetAgentId =
        typeof params.targetAgentId === "string" ? params.targetAgentId : undefined;
      const autoSelect = params.autoSelect === true;
      const task = typeof params.task === "string" ? params.task : "";
      const reason = typeof params.reason === "string" ? params.reason : "";
      const sharedState =
        typeof params.sharedState === "object" && params.sharedState !== null
          ? (params.sharedState as Record<string, unknown>)
          : undefined;
      const strategy =
        typeof params.strategy === "string"
          ? (params.strategy as HandoffStrategy)
          : "wait-for-completion";

      if (!task || !reason) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "task and reason are required", ok: false }),
            },
          ],
        };
      }

      let resolvedTargetId = targetAgentId;

      // Auto-select agent if requested
      if (autoSelect && !resolvedTargetId) {
        const selected = findAgent(task);
        if (selected) {
          resolvedTargetId = selected.id;
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "No suitable agent found for the task",
                  ok: false,
                  availableAgents: listAgents({ available: true }).map((a) => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                  })),
                }),
              },
            ],
          };
        }
      }

      if (!resolvedTargetId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "targetAgentId is required when autoSelect is not true",
                ok: false,
              }),
            },
          ],
        };
      }

      // Verify agent exists
      const targetAgent = getAgent(resolvedTargetId);
      if (!targetAgent) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Unknown agent: ${resolvedTargetId}`,
                ok: false,
                availableAgents: listAgents({ available: true }).map((a) => ({
                  id: a.id,
                  name: a.name,
                  description: a.description,
                })),
              }),
            },
          ],
        };
      }

      // Execute the handoff
      const result = await executeHandoff({
        sourceSessionKey: options.sessionKey ?? "unknown",
        targetAgentId: resolvedTargetId,
        message: task,
        reason,
        sharedState,
        strategy,
        timeoutMs: 60_000,
      });

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                error: result.error,
                targetAgent: {
                  id: targetAgent.id,
                  name: targetAgent.name,
                },
              }),
            },
          ],
        };
      }

      // Success - return the result
      const response: Record<string, unknown> = {
        ok: true,
        handoffId: result.context?.handoffId,
        targetAgent: {
          id: targetAgent.id,
          name: targetAgent.name,
          description: targetAgent.description,
        },
        strategy,
      };

      if (result.output) {
        response.output = result.output;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  };
}
