/**
 * Rule-based tool result validation (no LLM calls).
 * Runs in `after_tool_call` hook to detect failures, empty results, and errors.
 */

import type { ValidationResult } from "./types.js";
import { classifyError, classifyExitCode } from "./error-classifier.js";

type ToolCallEvent = {
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
  error?: string;
  exitCode?: number;
};

type ValidationRule = {
  name: string;
  applies: (event: ToolCallEvent) => boolean;
  check: (event: ToolCallEvent) => ValidationResult;
};

const rules: ValidationRule[] = [
  // Rule: detect non-zero exit codes (exec tool)
  {
    name: "exec-exit-code",
    applies: (event) => event.toolName === "exec" && event.exitCode != null,
    check: (event) => {
      const classification = classifyExitCode(event.exitCode!);
      if (event.exitCode === 0) {
        return { valid: true, confidence: 1, issues: [] };
      }
      return {
        valid: false,
        confidence: classification.confidence,
        issues: [`exit code ${event.exitCode}: ${classification.detail ?? "unknown"}`],
        suggestedAction:
          classification.suggestedStrategy === "retry_same"
            ? "retry_same"
            : classification.suggestedStrategy === "modify_params"
              ? "modify_params"
              : classification.suggestedStrategy === "alternative_tool"
                ? "alternative_tool"
                : "escalate",
      };
    },
  },

  // Rule: detect explicit error strings in results
  {
    name: "result-error-field",
    applies: (event) => {
      if (!event.result || typeof event.result !== "object") {
        return false;
      }
      const r = event.result as Record<string, unknown>;
      return "error" in r && typeof r.error === "string" && r.error.length > 0;
    },
    check: (event) => {
      const r = event.result as Record<string, unknown>;
      const errorMsg = String(r.error);
      const classification = classifyError(errorMsg);
      return {
        valid: false,
        confidence: classification.confidence,
        issues: [errorMsg],
        suggestedAction:
          classification.suggestedStrategy === "retry_same"
            ? "retry_same"
            : classification.suggestedStrategy === "modify_params"
              ? "modify_params"
              : classification.suggestedStrategy === "alternative_tool"
                ? "alternative_tool"
                : "escalate",
      };
    },
  },

  // Rule: detect empty results for search tools
  {
    name: "empty-search-results",
    applies: (event) => {
      if (!event.toolName) {
        return false;
      }
      const searchTools = ["web_search", "web_fetch", "memory_search"];
      if (!searchTools.includes(event.toolName)) {
        return false;
      }
      if (!event.result || typeof event.result !== "object") {
        return false;
      }
      const r = event.result as Record<string, unknown>;
      return Array.isArray(r.results) && r.results.length === 0;
    },
    check: () => ({
      valid: true, // Empty results aren't invalid, but worth noting
      confidence: 0.6,
      issues: ["search returned empty results"],
      suggestedAction: "modify_params",
    }),
  },

  // Rule: detect HTTP error status codes in web fetch results
  {
    name: "web-fetch-http-error",
    applies: (event) => {
      if (event.toolName !== "web_fetch") {
        return false;
      }
      if (!event.result || typeof event.result !== "object") {
        return false;
      }
      const r = event.result as Record<string, unknown>;
      return typeof r.statusCode === "number" && r.statusCode >= 400;
    },
    check: (event) => {
      const r = event.result as Record<string, unknown>;
      const status = r.statusCode as number;
      if (status === 403 || status === 401) {
        return {
          valid: false,
          confidence: 0.9,
          issues: [`HTTP ${status}: access denied`],
          suggestedAction: "alternative_tool",
        };
      }
      if (status === 404) {
        return {
          valid: false,
          confidence: 0.9,
          issues: [`HTTP ${status}: not found`],
          suggestedAction: "modify_params",
        };
      }
      if (status >= 500) {
        return {
          valid: false,
          confidence: 0.7,
          issues: [`HTTP ${status}: server error`],
          suggestedAction: "retry_same",
        };
      }
      return {
        valid: false,
        confidence: 0.6,
        issues: [`HTTP ${status}`],
        suggestedAction: "modify_params",
      };
    },
  },

  // Rule: detect file operation failures
  {
    name: "file-operation-failure",
    applies: (event) => {
      const fileTools = ["read", "write", "edit", "apply_patch"];
      if (!event.toolName || !fileTools.includes(event.toolName)) {
        return false;
      }
      return Boolean(event.error);
    },
    check: (event) => {
      const classification = classifyError(event.error ?? "unknown");
      return {
        valid: false,
        confidence: classification.confidence,
        issues: [event.error ?? "file operation failed"],
        suggestedAction:
          classification.suggestedStrategy === "retry_same"
            ? "retry_same"
            : classification.suggestedStrategy === "modify_params"
              ? "modify_params"
              : "escalate",
      };
    },
  },

  // Rule: detect disabled memory tool
  {
    name: "memory-disabled",
    applies: (event) => {
      if (!event.toolName?.startsWith("memory_")) {
        return false;
      }
      if (!event.result || typeof event.result !== "object") {
        return false;
      }
      const r = event.result as Record<string, unknown>;
      return r.disabled === true;
    },
    check: (event) => {
      const r = event.result as Record<string, unknown>;
      return {
        valid: false,
        confidence: 0.95,
        issues: [
          `memory tool disabled: ${typeof r.error === "string" ? r.error : "unknown reason"}`,
        ],
        suggestedAction: "escalate",
      };
    },
  },
];

export type ToolResultValidator = {
  validate: (event: ToolCallEvent) => ValidationResult;
};

export function createToolResultValidator(): ToolResultValidator {
  return {
    validate(event: ToolCallEvent): ValidationResult {
      // Check explicit tool error first
      if (event.error) {
        const classification = classifyError(event.error);
        return {
          valid: false,
          confidence: classification.confidence,
          issues: [event.error],
          suggestedAction:
            classification.suggestedStrategy === "retry_same"
              ? "retry_same"
              : classification.suggestedStrategy === "modify_params"
                ? "modify_params"
                : classification.suggestedStrategy === "alternative_tool"
                  ? "alternative_tool"
                  : "escalate",
        };
      }

      // Run through validation rules
      for (const rule of rules) {
        if (rule.applies(event)) {
          const result = rule.check(event);
          if (!result.valid || result.issues.length > 0) {
            return result;
          }
        }
      }

      // Default: valid
      return { valid: true, confidence: 1, issues: [] };
    },
  };
}
