/**
 * Classifies tool errors into categories and suggests recovery strategies.
 * Rule-based (no LLM calls) for predictable, fast classification.
 */

import type { ErrorClassification, ToolErrorCategory, RetryStrategy } from "./types.js";

type ErrorPattern = {
  pattern: RegExp;
  category: ToolErrorCategory;
  strategy: RetryStrategy;
  detail?: string;
};

const ERROR_PATTERNS: ErrorPattern[] = [
  // Transient errors (network, rate limits, timeouts)
  {
    pattern: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/i,
    category: "transient",
    strategy: "retry_same",
    detail: "network error",
  },
  {
    pattern: /rate.?limit|too many requests|429|throttl/i,
    category: "transient",
    strategy: "retry_same",
    detail: "rate limited",
  },
  {
    pattern: /timeout|timed?\s*out/i,
    category: "transient",
    strategy: "retry_same",
    detail: "timeout",
  },
  {
    pattern: /5\d\d\s*(server|internal|bad gateway|service unavailable)/i,
    category: "transient",
    strategy: "retry_same",
    detail: "server error",
  },
  {
    pattern: /EAGAIN|EBUSY|resource.*busy/i,
    category: "transient",
    strategy: "retry_same",
    detail: "resource busy",
  },

  // Resource errors (file not found, permission denied)
  {
    pattern: /ENOENT|no such file|file not found|not found/i,
    category: "resource",
    strategy: "modify_params",
    detail: "file not found",
  },
  {
    pattern: /EACCES|EPERM|permission denied|forbidden|403/i,
    category: "resource",
    strategy: "alternative_tool",
    detail: "permission denied",
  },
  {
    pattern: /EEXIST|already exists/i,
    category: "resource",
    strategy: "modify_params",
    detail: "resource exists",
  },
  {
    pattern: /ENOSPC|no space|disk full/i,
    category: "resource",
    strategy: "escalate",
    detail: "disk full",
  },
  {
    pattern: /404|not found/i,
    category: "resource",
    strategy: "modify_params",
    detail: "not found",
  },

  // Context limit errors
  {
    pattern: /context.?length|token.?limit|max.?tokens|too long|context.?window/i,
    category: "context_limit",
    strategy: "modify_params",
    detail: "context limit",
  },
  {
    pattern: /payload too large|413|request.*too large/i,
    category: "context_limit",
    strategy: "modify_params",
    detail: "payload too large",
  },

  // Semantic errors (invalid params, wrong format)
  {
    pattern: /invalid.*param|invalid.*argument|type.*error/i,
    category: "semantic",
    strategy: "modify_params",
    detail: "invalid parameters",
  },
  {
    pattern: /parse.*error|syntax.*error|JSON.*error/i,
    category: "semantic",
    strategy: "modify_params",
    detail: "parse error",
  },
  {
    pattern: /validation.*fail|schema.*error/i,
    category: "semantic",
    strategy: "modify_params",
    detail: "validation failed",
  },

  // Permanent errors
  {
    pattern: /401|unauthorized|invalid.*key|invalid.*token/i,
    category: "permanent",
    strategy: "escalate",
    detail: "authentication error",
  },
  {
    pattern: /deprecated|removed|unsupported/i,
    category: "permanent",
    strategy: "alternative_tool",
    detail: "unsupported",
  },
];

export function classifyError(errorMessage: string): ErrorClassification {
  const normalized = errorMessage.trim();
  if (!normalized) {
    return {
      category: "semantic",
      suggestedStrategy: "escalate",
      isRetryable: false,
      confidence: 0.3,
      detail: "empty error message",
    };
  }

  for (const entry of ERROR_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return {
        category: entry.category,
        suggestedStrategy: entry.strategy,
        isRetryable: entry.category === "transient",
        confidence: 0.85,
        detail: entry.detail,
      };
    }
  }

  // Fallback: unknown error
  return {
    category: "semantic",
    suggestedStrategy: "escalate",
    isRetryable: false,
    confidence: 0.4,
    detail: "unrecognized error pattern",
  };
}

/** Check if an exit code indicates a retriable failure. */
export function classifyExitCode(exitCode: number): ErrorClassification {
  if (exitCode === 0) {
    return {
      category: "transient",
      suggestedStrategy: "retry_same",
      isRetryable: false,
      confidence: 1,
      detail: "success",
    };
  }
  // Signal-killed processes (128+signal)
  if (exitCode > 128) {
    const signal = exitCode - 128;
    return {
      category: "transient",
      suggestedStrategy: "retry_same",
      isRetryable: true,
      confidence: 0.7,
      detail: `killed by signal ${signal}`,
    };
  }
  // Common non-zero exit codes
  if (exitCode === 1) {
    return {
      category: "semantic",
      suggestedStrategy: "modify_params",
      isRetryable: false,
      confidence: 0.6,
      detail: "general error",
    };
  }
  if (exitCode === 2) {
    return {
      category: "semantic",
      suggestedStrategy: "modify_params",
      isRetryable: false,
      confidence: 0.7,
      detail: "misuse of shell command",
    };
  }
  if (exitCode === 126 || exitCode === 127) {
    return {
      category: "resource",
      suggestedStrategy: "alternative_tool",
      isRetryable: false,
      confidence: 0.9,
      detail: exitCode === 126 ? "permission denied" : "command not found",
    };
  }
  return {
    category: "semantic",
    suggestedStrategy: "modify_params",
    isRetryable: false,
    confidence: 0.5,
    detail: `exit code ${exitCode}`,
  };
}
