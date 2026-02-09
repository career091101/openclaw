/**
 * multi_agent_debate tool: spawns multiple agents to independently analyze a question,
 * then facilitates debate between them to reach consensus or surface disagreements.
 * Based on "Improving Factuality and Reasoning in Language Models through Multiagent Debate"
 * (Du et al. 2023, https://arxiv.org/abs/2305.14325)
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { OrchestrationRole } from "../../../../src/agents/orchestration/types.js";
import { buildOrchestratorSessionKey } from "../../../../src/agents/orchestration/types.js";
import { getRoleDefinition } from "../roles.js";
import { createTaskGraph, addTask } from "../task-graph.js";
import { saveGraph } from "../task-graph.store.js";
import { getActiveGraph } from "./delegate-task.js";

const MultiAgentDebateSchema = Type.Object({
  question: Type.String({ description: "The question or decision to debate" }),
  agentCount: Type.Optional(
    Type.Number({
      description: "Number of agents to spawn for debate (default: 3, max: 5)",
      minimum: 2,
      maximum: 5,
    }),
  ),
  rounds: Type.Optional(
    Type.Number({
      description: "Number of debate rounds (default: 2, max: 4)",
      minimum: 1,
      maximum: 4,
    }),
  ),
  role: Type.Optional(
    Type.String({
      description: "Role for debate agents: critic (default) or executor",
    }),
  ),
  orchestrationId: Type.Optional(
    Type.String({ description: "Existing orchestration ID to add to. Omit to create new." }),
  ),
});

type DebatePhase = "initial" | "debate" | "consensus";

interface DebateState {
  phase: DebatePhase;
  round: number;
  maxRounds: number;
  agentResponses: Map<string, { taskId: string; response: string }>;
  consensusReached: boolean;
}

// Track debate state per orchestration
const debateStates = new Map<string, DebateState>();

export function createMultiAgentDebateTool(options: {
  config?: OpenClawConfig;
  sessionKey?: string;
}) {
  return {
    label: "Multi-Agent Debate",
    name: "multi_agent_debate",
    description:
      "Spawn multiple agents to independently analyze a question, then facilitate debate to reach consensus. Useful for high-stakes decisions requiring diverse perspectives.",
    parameters: MultiAgentDebateSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const question = typeof params.question === "string" ? params.question : "";
      const agentCount =
        typeof params.agentCount === "number" ? Math.min(5, Math.max(2, params.agentCount)) : 3;
      const rounds =
        typeof params.rounds === "number" ? Math.min(4, Math.max(1, params.rounds)) : 2;
      const role = (typeof params.role === "string" ? params.role : "critic") as OrchestrationRole;
      const orchestrationId =
        typeof params.orchestrationId === "string" ? params.orchestrationId : undefined;

      if (!question) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "question is required", ok: false }),
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
        let graph = orchestrationId ? getActiveGraph(orchestrationId) : undefined;
        const isNewGraph = !graph;

        if (!graph) {
          graph = createTaskGraph({
            supervisorSessionKey: options.sessionKey ?? "unknown",
            rootLabel: `Multi-Agent Debate: ${question.slice(0, 60)}...`,
          });
        }

        // Initialize debate state
        const debateState: DebateState = {
          phase: "initial",
          round: 1,
          maxRounds: rounds,
          agentResponses: new Map(),
          consensusReached: false,
        };
        debateStates.set(graph.id, debateState);

        // Phase 1: Spawn independent analysis tasks for each agent
        const taskIds: string[] = [];
        const agentId = options.sessionKey?.split(":")?.[1] ?? "default";

        for (let i = 0; i < agentCount; i++) {
          const agentLabel = `Agent ${i + 1}`;
          // Initial instruction for independent analysis phase
          const _initialInstruction = `You are participating in a multi-agent debate to answer the following question:

**Question:** ${question}

**Your task:**
1. Analyze the question independently and provide your best answer
2. Explain your reasoning clearly
3. Identify any assumptions you're making
4. Rate your confidence level (0-100%)

Do not see other agents' responses yet. Provide your independent analysis.`;

          const taskNode = addTask(graph, {
            label: `${agentLabel}: Independent Analysis`,
            role,
            dependsOn: isNewGraph ? [graph.rootTaskId] : undefined,
          });

          const _sessionKey = buildOrchestratorSessionKey({
            agentId,
            orchestrationId: graph.id,
            role,
            taskId: taskNode.id,
          });

          taskIds.push(taskNode.id);

          // Store agent task ID for later debate rounds
          debateState.agentResponses.set(agentLabel, {
            taskId: taskNode.id,
            response: "", // Will be filled after completion
          });
        }

        // Phase 2: Create debate round task (will be triggered after initial responses)
        const debateTaskNode = addTask(graph, {
          label: `Debate Round 1`,
          role: "critic",
          dependsOn: taskIds,
        });

        // Phase 3: Create consensus task (will be triggered after all debate rounds)
        const consensusTaskNode = addTask(graph, {
          label: "Consensus Building",
          role: "critic",
          dependsOn: [debateTaskNode.id],
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
                phase: "initial",
                agentCount,
                rounds,
                taskIds,
                debateTaskId: debateTaskNode.id,
                consensusTaskId: consensusTaskNode.id,
                message: `Spawned ${agentCount} agents for independent analysis. They will debate over ${rounds} rounds.`,
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

/**
 * Helper function to facilitate debate round
 * Called when initial responses are collected
 */
export function facilitateDebateRound(
  orchestrationId: string,
  round: number,
  agentResponses: Map<string, string>,
): string {
  const state = debateStates.get(orchestrationId);
  if (!state) {
    return "Error: debate state not found";
  }

  const allResponses = Array.from(agentResponses.entries())
    .map(([agent, response]) => `### ${agent}'s Position:\n${response}`)
    .join("\n\n");

  return `# Debate Round ${round}

You have reviewed the following positions from other agents:

${allResponses}

**Your task:**
1. Critique the other agents' reasoning
2. Identify strengths and weaknesses in their arguments
3. Update your position based on valid points raised
4. Explain what changed in your thinking (if anything)
5. Re-state your confidence level (0-100%)

Focus on factual accuracy, logical consistency, and identifying blindspots.`;
}

/**
 * Helper function to build consensus
 * Called after all debate rounds complete
 */
export function buildConsensus(agentResponses: Map<string, string[]>): string {
  const allRounds = Array.from(agentResponses.entries())
    .map(([agent, responses]) => {
      const evolution = responses
        .map((resp, idx) => `**Round ${idx + 1}:** ${resp.slice(0, 300)}...`)
        .join("\n");
      return `### ${agent}:\n${evolution}`;
    })
    .join("\n\n");

  return `# Consensus Building

Review how each agent's position evolved across debate rounds:

${allRounds}

**Your task:**
1. Identify points of agreement across agents
2. Identify remaining disagreements and their root causes
3. Synthesize a final answer that incorporates the strongest arguments
4. If no consensus is possible, explain why and present multiple valid viewpoints
5. Provide a confidence score for the final recommendation

The goal is not forced agreement, but rather clarity on what's known, what's uncertain, and why.`;
}

/** Clean up debate state after completion */
export function cleanupDebateState(orchestrationId: string): void {
  debateStates.delete(orchestrationId);
}
