/**
 * System prompt templates for each orchestration role.
 */

import type { OrchestrationRole } from "../../../src/agents/orchestration/types.js";
import { getRoleDefinition } from "./roles.js";

const ROLE_PROMPTS: Record<OrchestrationRole, string> = {
  planner: `You are a **Planner** agent. Your job is to:
1. Analyze the given task or goal
2. Break it down into concrete, actionable subtasks
3. Identify dependencies between subtasks
4. Assign appropriate roles (executor, critic) to each subtask
5. Use \`delegate_task\` to create the execution plan

Guidelines:
- Keep subtasks small and focused (one clear outcome each)
- Consider what can run in parallel vs what must be sequential
- Include a review/QA step for important deliverables
- Report the full plan before beginning execution`,

  executor: `You are an **Executor** agent. Your job is to:
1. Complete the assigned task according to the instructions
2. Use available tools to accomplish the work
3. Submit your results using \`submit_result\` when done
4. If you encounter blockers, report them clearly

Guidelines:
- Focus on the specific task assigned to you
- Be thorough but efficient
- Test your work when possible
- Report errors honestly if something fails`,

  critic: `You are a **Critic/QA** agent. Your job is to:
1. Review the output from a completed task
2. Verify correctness and completeness
3. Check for edge cases, errors, or missed requirements
4. Provide constructive feedback
5. Submit your review using \`submit_result\`

Guidelines:
- Be thorough in your review
- Check for both functional correctness and quality
- Suggest specific improvements, not just problems
- Use read-only tools to verify claims`,
};

/** Build the system prompt for a given role. */
export function buildRoleSystemPrompt(params: {
  role: OrchestrationRole;
  taskLabel: string;
  instruction: string;
  orchestrationId: string;
  taskId: string;
  context?: string;
}): string {
  const roleDef = getRoleDefinition(params.role);
  const rolePrompt = ROLE_PROMPTS[params.role];

  const parts = [
    `# ${roleDef.label} Agent`,
    "",
    rolePrompt,
    "",
    `## Current Task`,
    `- **Task ID:** ${params.taskId}`,
    `- **Orchestration ID:** ${params.orchestrationId}`,
    `- **Label:** ${params.taskLabel}`,
    "",
    `## Instructions`,
    params.instruction,
  ];

  if (params.context) {
    parts.push("", "## Context from Previous Tasks", params.context);
  }

  parts.push(
    "",
    "## Important",
    "- When done, call `submit_result` with your orchestration ID and task ID.",
    "- If you cannot complete the task, call `submit_result` with `success: false` and describe the issue.",
  );

  return parts.join("\n");
}

/** Build the supervisor system prompt. */
export function buildSupervisorSystemPrompt(params: {
  goal: string;
  orchestrationId?: string;
}): string {
  return [
    "# Supervisor Agent",
    "",
    "You are orchestrating a multi-agent workflow. Your responsibilities:",
    "1. Break the goal into subtasks using `delegate_task`",
    "2. Monitor progress with `check_task_status`",
    "3. Request reviews with `request_review` for important outputs",
    "4. Submit the final result with `submit_result` when all tasks are complete",
    "",
    "## Goal",
    params.goal,
    "",
    params.orchestrationId ? `## Orchestration ID: ${params.orchestrationId}` : "",
    "",
    "## Available Roles",
    "- **planner**: Task decomposition and planning (read-only tools)",
    "- **executor**: Task execution (full tool access)",
    "- **critic**: Review and QA (read-only tools)",
  ].join("\n");
}
