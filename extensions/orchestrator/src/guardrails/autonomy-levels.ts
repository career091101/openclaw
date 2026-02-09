/**
 * Progressive autonomy: controls which tools require human approval
 * based on the configured autonomy level.
 *
 * Level 0: All tool calls require approval
 * Level 1: Read-only tools are autonomous, write tools require approval
 * Level 2: Planning + read are autonomous, execution requires approval
 * Level 3: Most execution is autonomous, external communication requires approval
 * Level 4: Full autonomy (goal delegation)
 *
 * Can be enhanced with risk-based scoring for more granular control.
 */

import type { AutonomyLevel } from "../../../../src/agents/orchestration/types.js";
import {
  calculateRiskScore,
  checkRiskThreshold,
  explainRiskScore,
  type RiskTolerance,
  type RiskScore,
} from "./risk-scoring.js";

// Read-only tools that never modify state
const READ_ONLY_TOOLS = new Set([
  "read",
  "memory_search",
  "memory_get",
  "web_search",
  "web_fetch",
  "sessions_list",
  "sessions_history",
  "session_status",
  "check_task_status",
  "agents_list",
]);

// Planning tools
const PLANNING_TOOLS = new Set(["delegate_task", "submit_result", "request_review"]);

// External communication tools
const EXTERNAL_TOOLS = new Set(["message", "sessions_send", "sessions_spawn"]);

export type AutonomyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  riskScore?: RiskScore; // Optional risk assessment details
};

/**
 * Check if a tool call should be allowed at the given autonomy level.
 */
export function checkAutonomy(toolName: string, level: AutonomyLevel): AutonomyDecision {
  const normalized = toolName.trim().toLowerCase();

  // Level 0: everything needs approval
  if (level === 0) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: "autonomy level 0: all tools require approval",
    };
  }

  // Level 1: read-only is autonomous
  if (level === 1) {
    if (READ_ONLY_TOOLS.has(normalized)) {
      return { allowed: true, requiresApproval: false, reason: "read-only tool at level 1" };
    }
    return {
      allowed: true,
      requiresApproval: true,
      reason: "non-read tool at level 1: requires approval",
    };
  }

  // Level 2: planning + read are autonomous
  if (level === 2) {
    if (READ_ONLY_TOOLS.has(normalized) || PLANNING_TOOLS.has(normalized)) {
      return { allowed: true, requiresApproval: false, reason: "read/planning tool at level 2" };
    }
    return {
      allowed: true,
      requiresApproval: true,
      reason: "execution tool at level 2: requires approval",
    };
  }

  // Level 3: most execution is autonomous, external comm needs approval
  if (level === 3) {
    if (EXTERNAL_TOOLS.has(normalized)) {
      return {
        allowed: true,
        requiresApproval: true,
        reason: "external communication at level 3: requires approval",
      };
    }
    return { allowed: true, requiresApproval: false, reason: "autonomous at level 3" };
  }

  // Level 4: full autonomy
  return { allowed: true, requiresApproval: false, reason: "full autonomy at level 4" };
}

/**
 * Get a human-readable description of an autonomy level.
 */
export function describeAutonomyLevel(level: AutonomyLevel): string {
  switch (level) {
    case 0:
      return "Level 0: All tool calls require human approval";
    case 1:
      return "Level 1: Read-only tools are autonomous, write tools require approval";
    case 2:
      return "Level 2: Planning + read are autonomous, execution requires approval";
    case 3:
      return "Level 3: Most execution is autonomous, external communication requires approval";
    case 4:
      return "Level 4: Full goal-delegation autonomy";
    default:
      return `Level ${level as number}: Unknown`;
  }
}

/**
 * Determine if a tool is considered "destructive" (extra caution).
 */
export function isDestructiveTool(toolName: string): boolean {
  const destructive = new Set(["exec", "memory_forget", "process"]);
  return destructive.has(toolName.trim().toLowerCase());
}

/**
 * Check autonomy with risk-based scoring overlay.
 * Combines autonomy-level policy with granular risk assessment.
 *
 * At level 4, risk tolerance is applied. At lower levels, autonomy-level policy takes precedence.
 */
export function checkAutonomyWithRisk(params: {
  toolName: string;
  autonomyLevel: AutonomyLevel;
  riskTolerance?: RiskTolerance;
  toolParams?: Record<string, unknown>;
  target?: string;
  cost?: number;
}): AutonomyDecision {
  const { toolName, autonomyLevel, riskTolerance = "balanced", toolParams, target, cost } = params;

  // First, check autonomy level policy
  const autonomyDecision = checkAutonomy(toolName, autonomyLevel);

  // If autonomy level already requires approval (levels 0-3), honor that
  if (autonomyLevel < 4 && autonomyDecision.requiresApproval) {
    return autonomyDecision;
  }

  // At level 4 (full autonomy), apply risk-based scoring
  if (autonomyLevel === 4) {
    const riskScore = calculateRiskScore({
      toolName,
      toolParams,
      target,
      cost,
    });

    const riskCheck = checkRiskThreshold(riskScore, riskTolerance);

    if (riskCheck.requiresApproval) {
      return {
        allowed: true,
        requiresApproval: true,
        reason: `${riskCheck.reason}: ${explainRiskScore(riskScore)}`,
        riskScore,
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      reason: `autonomous at level 4 with ${riskTolerance} risk tolerance: ${explainRiskScore(riskScore)}`,
      riskScore,
    };
  }

  // Level 3 and below: if not already requiring approval, allow autonomously
  return autonomyDecision;
}

/**
 * Get risk assessment for a tool call without making an approval decision.
 * Useful for logging, monitoring, or user information.
 */
export function assessToolRisk(params: {
  toolName: string;
  toolParams?: Record<string, unknown>;
  target?: string;
  cost?: number;
}): RiskScore {
  return calculateRiskScore(params);
}
