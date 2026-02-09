/**
 * Risk-based confirmation thresholds: determines when to request user approval
 * based on action risk scores. Complements autonomy-levels.ts with granular,
 * action-specific risk assessment.
 *
 * Risk categories:
 * - LOW (0-2): Read-only operations, safe queries
 * - MEDIUM (3-5): Workspace modifications, reversible changes
 * - HIGH (6-8): System modifications, external API calls with cost
 * - CRITICAL (9-10): Destructive operations, irreversible actions, security-sensitive
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type RiskScore = {
  score: number; // 0-10
  level: RiskLevel;
  factors: string[]; // Explanation of risk contributors
  requiresApproval: boolean;
};

export type RiskTolerance = "conservative" | "balanced" | "aggressive";

// Risk tolerance thresholds (minimum score requiring approval)
const APPROVAL_THRESHOLDS: Record<RiskTolerance, number> = {
  conservative: 3, // Approve medium+ risk
  balanced: 6, // Approve high+ risk
  aggressive: 9, // Approve only critical risk
};

// Base risk scores for tool categories
const TOOL_RISK_BASELINE: Record<string, number> = {
  // Read-only tools (0-2)
  read: 0,
  memory_search: 0,
  memory_get: 0,
  web_search: 1,
  web_fetch: 1,
  sessions_list: 0,
  sessions_history: 0,
  session_status: 0,
  check_task_status: 0,
  agents_list: 0,
  image: 1,

  // Write tools in workspace (3-5)
  write: 3,
  edit: 3,
  apply_patch: 4,
  memory_write: 3,
  memory_update: 3,

  // Orchestration (3-4)
  delegate_task: 3,
  submit_result: 2,
  request_review: 2,

  // External communication (5-6)
  sessions_send: 5,
  sessions_spawn: 6,
  message: 5,

  // Runtime execution (6-7)
  exec: 7,
  process: 7,

  // Destructive operations (8-10)
  memory_forget: 8,
  cron: 7,
  gateway: 8,

  // Self-improve (5-6)
  evaluate_tip: 2,
  record_tip: 4,
  check_improve_status: 0,
};

/**
 * Calculate risk score for a tool call based on tool name, parameters, and target.
 */
export function calculateRiskScore(params: {
  toolName: string;
  toolParams?: Record<string, unknown>;
  target?: string; // e.g., file path, API endpoint
  cost?: number; // Estimated cost in USD
}): RiskScore {
  const { toolName, toolParams, target, cost } = params;
  const normalized = toolName.trim().toLowerCase();

  // Start with baseline risk
  let score = TOOL_RISK_BASELINE[normalized] ?? 5; // Default: medium risk
  const factors: string[] = [`base: ${normalized}`];

  // Factor 1: Target scope (workspace vs system)
  if (target) {
    if (isSystemPath(target)) {
      score += 3;
      factors.push("system-level target (+3)");
    } else if (isWorkspacePath(target)) {
      score += 0;
      factors.push("workspace target (+0)");
    } else {
      score += 2;
      factors.push("external target (+2)");
    }
  }

  // Factor 2: Reversibility
  if (!isReversible(normalized, toolParams)) {
    score += 2;
    factors.push("irreversible (+2)");
  }

  // Factor 3: Cost
  if (cost !== undefined) {
    if (cost > 1.0) {
      score += 3;
      factors.push(`high cost $${cost.toFixed(2)} (+3)`);
    } else if (cost > 0.1) {
      score += 1;
      factors.push(`moderate cost $${cost.toFixed(2)} (+1)`);
    }
  }

  // Factor 4: Batch operations (higher risk)
  if (isBatchOperation(toolParams)) {
    score += 1;
    factors.push("batch operation (+1)");
  }

  // Factor 5: Security-sensitive patterns
  if (hasSecuritySensitivePattern(normalized, toolParams, target)) {
    score += 2;
    factors.push("security-sensitive (+2)");
  }

  // Clamp score to 0-10
  score = Math.max(0, Math.min(10, score));

  const level = getRiskLevel(score);

  return {
    score,
    level,
    factors,
    requiresApproval: false, // Determined by checkRiskThreshold
  };
}

/**
 * Check if a risk score exceeds the approval threshold for given tolerance.
 */
export function checkRiskThreshold(
  riskScore: RiskScore,
  tolerance: RiskTolerance,
): {
  requiresApproval: boolean;
  reason: string;
} {
  const threshold = APPROVAL_THRESHOLDS[tolerance];

  if (riskScore.score >= threshold) {
    return {
      requiresApproval: true,
      reason: `risk score ${riskScore.score} (${riskScore.level}) exceeds ${tolerance} threshold ${threshold}`,
    };
  }

  return {
    requiresApproval: false,
    reason: `risk score ${riskScore.score} (${riskScore.level}) within ${tolerance} tolerance`,
  };
}

/**
 * Determine risk level from numeric score.
 */
function getRiskLevel(score: number): RiskLevel {
  if (score >= 9) {
    return "critical";
  }
  if (score >= 6) {
    return "high";
  }
  if (score >= 3) {
    return "medium";
  }
  return "low";
}

/**
 * Check if target path is system-level (outside workspace).
 */
function isSystemPath(path: string): boolean {
  const systemPrefixes = ["/etc/", "/usr/", "/var/", "/sys/", "/proc/", "/bin/", "/sbin/"];
  return systemPrefixes.some((prefix) => path.startsWith(prefix));
}

/**
 * Check if target path is within workspace.
 */
function isWorkspacePath(path: string): boolean {
  // Assume workspace paths are relative or start with known workspace dirs
  return (
    !path.startsWith("/") ||
    path.includes("/workspace/") ||
    path.includes("/.openclaw/workspace/")
  );
}

/**
 * Check if operation is reversible.
 */
function isReversible(toolName: string, params?: Record<string, unknown>): boolean {
  // Irreversible tools
  const irreversibleTools = new Set([
    "memory_forget",
    "exec", // Depends on command
    "process",
    "cron", // Depends on action
    "sessions_send", // Message sent can't be unsent
    "message",
  ]);

  if (irreversibleTools.has(toolName)) {
    // Check if exec/cron have safe commands
    if (toolName === "exec" && params?.command && typeof params.command === "string") {
      const cmd = params.command.toLowerCase();
      if (cmd.startsWith("ls") || cmd.startsWith("cat") || cmd.startsWith("echo")) {
        return true; // Safe read commands
      }
      return false;
    }
    // If no params provided for exec/process/cron, we can't determine reversibility
    // Treat as neutral (reversible) to avoid false positives
    if ((toolName === "exec" || toolName === "process" || toolName === "cron") && !params) {
      return true;
    }
    return false;
  }

  return true; // Most file/memory operations are reversible
}

/**
 * Check if operation is a batch (affects multiple targets).
 */
function isBatchOperation(params?: Record<string, unknown>): boolean {
  if (!params) {
    return false;
  }

  // Look for array parameters or patterns indicating batch
  for (const value of Object.values(params)) {
    if (Array.isArray(value) && value.length > 1) {
      return true;
    }
  }

  return false;
}

/**
 * Check for security-sensitive patterns.
 */
function hasSecuritySensitivePattern(
  toolName: string,
  params?: Record<string, unknown>,
  target?: string,
): boolean {
  // Sensitive file patterns
  const sensitiveFiles = [
    ".env",
    ".ssh/",
    "id_rsa",
    "credentials",
    "secrets",
    "password",
    ".npmrc",
    ".pypirc",
  ];

  if (target && sensitiveFiles.some((pattern) => target.includes(pattern))) {
    return true;
  }

  // Sensitive exec patterns
  if (toolName === "exec" && params?.command && typeof params.command === "string") {
    const cmd = params.command.toLowerCase();
    const dangerousCommands = ["rm -rf", "dd ", "mkfs", "fdisk", "chmod 777", "sudo"];
    if (dangerousCommands.some((dangerous) => cmd.includes(dangerous))) {
      return true;
    }
  }

  return false;
}

/**
 * Get a user-friendly explanation of risk score.
 */
export function explainRiskScore(riskScore: RiskScore): string {
  const { score, level, factors } = riskScore;
  return `Risk: ${score}/10 (${level}). Factors: ${factors.join(", ")}.`;
}
