/**
 * Handoff execution logic.
 * Manages the transfer of control between agents with context preservation.
 */

import crypto from "node:crypto";
import type { GatewayMessageChannel } from "../../../../src/utils/message-channel.js";
import { callGateway } from "../../../../src/gateway/call.js";
import { createSubsystemLogger } from "../../../../src/logging/subsystem.js";
import { AGENT_LANE_NESTED } from "../../../../src/agents/lanes.js";
import type { HandoffContext, HandoffResult, HandoffStrategy } from "./types.js";
import { getAgent } from "./registry.js";

const log = createSubsystemLogger("agent-handoff/executor");

/** In-memory store of active handoff contexts */
const activeHandoffs = new Map<string, HandoffContext>();

/**
 * Create a new handoff context.
 */
export function createHandoffContext(params: {
  originSessionKey: string;
  targetAgentId: string;
  reason: string;
  sharedState?: Record<string, unknown>;
}): HandoffContext {
  const handoffId = crypto.randomBytes(16).toString("hex");
  const context: HandoffContext = {
    handoffId,
    originSessionKey: params.originSessionKey,
    agentStack: [params.originSessionKey, params.targetAgentId],
    sharedState: params.sharedState ?? {},
    reason: params.reason,
    timestamp: Date.now(),
  };
  activeHandoffs.set(handoffId, context);
  return context;
}

/**
 * Get an active handoff context.
 */
export function getHandoffContext(handoffId: string): HandoffContext | undefined {
  return activeHandoffs.get(handoffId);
}

/**
 * Update shared state in a handoff context.
 */
export function updateHandoffState(
  handoffId: string,
  updates: Record<string, unknown>,
): boolean {
  const context = activeHandoffs.get(handoffId);
  if (!context) {
    return false;
  }
  context.sharedState = { ...context.sharedState, ...updates };
  return true;
}

/**
 * Execute a handoff to a specialized agent.
 */
export async function executeHandoff(params: {
  /** Source agent session key */
  sourceSessionKey: string;
  /** Target agent ID (from registry) */
  targetAgentId: string;
  /** Message/task for the target agent */
  message: string;
  /** Reason for the handoff */
  reason: string;
  /** Optional shared state */
  sharedState?: Record<string, unknown>;
  /** Handoff strategy */
  strategy?: HandoffStrategy;
  /** Source channel (for announcing results) */
  sourceChannel?: GatewayMessageChannel;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}): Promise<HandoffResult> {
  const {
    sourceSessionKey,
    targetAgentId,
    message,
    reason,
    sharedState = {},
    strategy = "wait-for-completion",
    sourceChannel,
    timeoutMs = 60_000,
  } = params;

  // Validate target agent exists
  const targetAgent = getAgent(targetAgentId);
  if (!targetAgent) {
    return {
      success: false,
      error: `Agent "${targetAgentId}" not found in registry`,
    };
  }

  if (!targetAgent.available) {
    return {
      success: false,
      error: `Agent "${targetAgentId}" is not currently available`,
    };
  }

  // Create handoff context
  const context = createHandoffContext({
    originSessionKey: sourceSessionKey,
    targetAgentId,
    reason,
    sharedState,
  });

  log.info(
    `Handoff initiated: ${sourceSessionKey} -> ${targetAgentId} (${context.handoffId})`,
  );

  try {
    // Build the target session key
    const sourceAgentId = sourceSessionKey.split(":")?.[1] ?? "unknown";
    const targetSessionKey = `agent:${targetAgentId}:handoff:${context.handoffId}`;

    // Build the specialized system prompt
    const handoffPrompt = buildHandoffSystemPrompt({
      context,
      targetAgent,
      message,
    });

    // Execute the handoff based on strategy
    switch (strategy) {
      case "immediate":
        // Transfer control immediately without waiting
        await callGateway({
          method: "agent.send",
          params: {
            sessionKey: targetSessionKey,
            message: message,
            extraSystemPrompt: handoffPrompt,
            lane: AGENT_LANE_NESTED,
          },
          timeoutMs: 5_000,
        });

        return {
          success: true,
          targetSessionKey,
          context,
        };

      case "wait-for-completion": {
        // Wait for the target agent to complete the task
        const runResult = await callGateway<{ runId?: string }>({
          method: "agent.send",
          params: {
            sessionKey: targetSessionKey,
            message: message,
            extraSystemPrompt: handoffPrompt,
            lane: AGENT_LANE_NESTED,
          },
          timeoutMs: Math.min(timeoutMs, 5_000),
        });

        if (!runResult?.runId) {
          return {
            success: false,
            error: "Failed to start target agent",
          };
        }

        // Wait for completion
        const waitResult = await callGateway<{ status: string; output?: string }>({
          method: "agent.wait",
          params: {
            runId: runResult.runId,
            timeoutMs: timeoutMs - 5_000,
          },
          timeoutMs: timeoutMs,
        });

        if (waitResult?.status !== "ok") {
          return {
            success: false,
            error: "Target agent did not complete in time",
            targetSessionKey,
            context,
          };
        }

        // Read the agent's final output
        const output = waitResult.output ?? "No output from target agent";

        log.info(`Handoff completed: ${context.handoffId}`);

        return {
          success: true,
          targetSessionKey,
          context,
          output,
        };
      }

      case "async":
        // Fire and forget
        await callGateway({
          method: "agent.send",
          params: {
            sessionKey: targetSessionKey,
            message: message,
            extraSystemPrompt: handoffPrompt,
            lane: AGENT_LANE_NESTED,
          },
          timeoutMs: 5_000,
        });

        return {
          success: true,
          targetSessionKey,
          context,
        };

      default:
        return {
          success: false,
          error: `Unknown handoff strategy: ${strategy as string}`,
        };
    }
  } catch (err) {
    log.error(`Handoff failed: ${context.handoffId}`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      context,
    };
  }
}

/**
 * Build the system prompt for a handoff.
 */
function buildHandoffSystemPrompt(params: {
  context: HandoffContext;
  targetAgent: { name: string; description: string; systemPrompt?: string };
  message: string;
}): string {
  const { context, targetAgent, message } = params;

  const parts: string[] = [];

  // Role definition
  if (targetAgent.systemPrompt) {
    parts.push(targetAgent.systemPrompt);
  }

  // Handoff context
  parts.push(
    `\n## Handoff Context\n` +
      `You have been handed off this task from another agent.\n` +
      `- Handoff ID: ${context.handoffId}\n` +
      `- Origin: ${context.originSessionKey}\n` +
      `- Reason: ${context.reason}\n` +
      `- Task: ${message}\n`,
  );

  // Shared state (if any)
  if (Object.keys(context.sharedState).length > 0) {
    parts.push(
      `\n## Shared State\n` +
        `The following state has been passed to you:\n` +
        `\`\`\`json\n${JSON.stringify(context.sharedState, null, 2)}\n\`\`\`\n`,
    );
  }

  // Instructions
  parts.push(
    `\n## Instructions\n` +
      `1. Focus on completing the task described above\n` +
      `2. Use your specialized capabilities (${targetAgent.description})\n` +
      `3. When done, provide a clear summary of what you accomplished\n` +
      `4. If you need to hand off to another specialist, use the handoff_to_agent tool\n`,
  );

  return parts.join("\n");
}

/**
 * Clean up completed handoff contexts older than 1 hour.
 */
export function cleanupHandoffContexts(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, context] of activeHandoffs) {
    if (context.timestamp < oneHourAgo) {
      activeHandoffs.delete(id);
    }
  }
}

// Clean up every 10 minutes
setInterval(cleanupHandoffContexts, 10 * 60 * 1000);
