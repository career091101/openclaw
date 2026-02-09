/**
 * Tool rehearsal: pre-execution validation for destructive operations.
 * Simulates operations before execution to catch potential issues.
 */

import type { ValidationResult } from "./types.js";
import path from "node:path";
import { existsSync, statSync } from "node:fs";

export type ToolRehearsalInput = {
  toolName: string;
  params: Record<string, unknown>;
  workspacePath?: string;
};

export type ToolRehearsalResult = ValidationResult & {
  warnings?: string[];
  destructiveLevel?: "none" | "low" | "medium" | "high" | "critical";
  saferAlternatives?: string[];
  shouldProceed?: boolean;
};

/** Important files that should never be modified without explicit confirmation */
const PROTECTED_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  ".git/config",
  ".gitignore",
  "tsconfig.json",
  "openclaw.json",
  ".env",
];

/** Dangerous command patterns that indicate high-risk operations */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /rm\s+-fr/i,
  /--force/i,
  /--no-preserve-root/i,
  /sudo\s+rm/i,
  />\s*\/dev\//i,
  /mkfs/i,
  /dd\s+if=/i,
  /format\s+[a-z]:/i, // Windows format command
];

/** System-critical paths that should never be touched */
const CRITICAL_PATHS = [
  "/",
  "/bin",
  "/sbin",
  "/usr",
  "/etc",
  "/var",
  "/sys",
  "/proc",
  "/dev",
  "C:\\Windows",
  "C:\\Program Files",
];

/**
 * Rehearse a tool operation before execution to detect potential issues.
 * Returns validation result with warnings and risk assessment.
 */
export function rehearseToolOperation(input: ToolRehearsalInput): ToolRehearsalResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const saferAlternatives: string[] = [];
  let confidence = 1.0;
  let destructiveLevel: ToolRehearsalResult["destructiveLevel"] = "none";
  let shouldProceed = true;

  // Check tool type
  const toolLower = input.toolName.toLowerCase();

  // 1. File write operations
  if (toolLower === "write" || toolLower === "edit") {
    destructiveLevel = "medium";
    const filePath = getPathFromParams(input.params);

    if (filePath) {
      // Check if overwriting protected file
      const fileName = path.basename(filePath);
      if (PROTECTED_FILES.some((pf) => fileName === pf || filePath.endsWith(pf))) {
        issues.push(`Attempting to modify protected file: ${fileName}`);
        warnings.push("This file is critical to project configuration");
        destructiveLevel = "high";
        confidence *= 0.3;
        shouldProceed = false;
      }

      // Check if file exists (overwrite warning)
      if (toolLower === "write" && existsSync(filePath)) {
        const stats = statSync(filePath);
        if (stats.size > 10000) {
          warnings.push(
            `Overwriting existing file (${Math.round(stats.size / 1024)}KB): ${path.basename(filePath)}`,
          );
          saferAlternatives.push("Use 'edit' tool to modify specific sections instead of full overwrite");
          // Only set to medium if not already higher
          if (destructiveLevel === "none" || destructiveLevel === "low") {
            destructiveLevel = "medium";
          }
          confidence *= 0.7;
        }
      }

      // Check if path is outside workspace
      if (input.workspacePath && !filePath.startsWith(input.workspacePath)) {
        warnings.push(`Writing outside workspace: ${filePath}`);
        // Only upgrade if not already critical
        if (destructiveLevel !== "critical") {
          destructiveLevel = "high";
        }
        confidence *= 0.6;
      }
    }
  }

  // 2. Exec operations
  if (toolLower === "exec" || toolLower === "bash") {
    const command = typeof input.params.command === "string" ? input.params.command : "";

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        issues.push(`Dangerous command pattern detected: ${pattern.toString()}`);
        warnings.push("This command could cause irreversible damage");
        destructiveLevel = "critical";
        confidence *= 0.1;
        shouldProceed = false;
        break;
      }
    }

    // Check for deletion operations
    if (/\brm\b|\bdel\b|\berase\b/i.test(command)) {
      warnings.push("Command includes file deletion");
      destructiveLevel = destructiveLevel === "critical" ? "critical" : "high";
      saferAlternatives.push("Consider moving files to trash instead of permanent deletion");
      confidence *= 0.5;
    }

    // Check for write operations to system paths
    for (const criticalPath of CRITICAL_PATHS) {
      // Skip URL matches (contains ://) to avoid false positives
      if (command.includes("://") && criticalPath === "/") {
        continue;
      }
      if (command.includes(criticalPath) && /write|>|>>|\||tee/i.test(command)) {
        issues.push(`Command attempts to modify system path: ${criticalPath}`);
        destructiveLevel = "critical";
        shouldProceed = false;
        confidence *= 0.1;
        break;
      }
    }

    // Check for network operations
    if (/curl|wget|fetch|http/i.test(command) && />\s*\/|\|/i.test(command)) {
      warnings.push("Command downloads content and writes to file system");
      // Only set to medium if not already higher
      if (destructiveLevel === "none" || destructiveLevel === "low") {
        destructiveLevel = "medium";
      }
      confidence *= 0.8;
    }
  }

  // 3. Apply_patch operations (if exists)
  if (toolLower === "apply_patch") {
    // Only set to medium if not already higher
    if (destructiveLevel === "none" || destructiveLevel === "low") {
      destructiveLevel = "medium";
    }
    warnings.push("Patch operations modify code in-place");
    saferAlternatives.push("Review patch content before applying");
    confidence *= 0.8;
  }

  // 4. Process kill operations
  if (toolLower === "process" && input.params.action === "kill") {
    warnings.push("Killing process may cause data loss");
    // Only set to medium if not already higher
    if (destructiveLevel === "none" || destructiveLevel === "low") {
      destructiveLevel = "medium";
    }
    confidence *= 0.7;
  }

  const valid = shouldProceed && issues.length === 0;

  return {
    valid,
    confidence,
    issues,
    warnings,
    destructiveLevel,
    saferAlternatives: saferAlternatives.length > 0 ? saferAlternatives : undefined,
    shouldProceed,
    suggestedAction: shouldProceed ? undefined : "modify_params",
  };
}

/**
 * Extract file path from various tool parameter formats
 */
function getPathFromParams(params: Record<string, unknown>): string | null {
  // Try common path parameter names
  const pathKeys = ["path", "file_path", "filePath", "file", "target"];

  for (const key of pathKeys) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

/**
 * Check if a tool operation is destructive and requires rehearsal
 */
export function isDestructiveOperation(toolName: string): boolean {
  const destructiveTools = [
    "write",
    "edit",
    "apply_patch",
    "exec",
    "bash",
    "process", // when action=kill
  ];

  return destructiveTools.includes(toolName.toLowerCase());
}

/**
 * Format rehearsal result into a human-readable summary
 */
export function formatRehearsalSummary(result: ToolRehearsalResult): string {
  const lines: string[] = [];

  lines.push(`🔍 Tool Rehearsal Result`);
  lines.push(`Destructive Level: ${result.destructiveLevel?.toUpperCase() || "NONE"}`);
  lines.push(`Confidence: ${Math.round(result.confidence * 100)}%`);
  lines.push(`Should Proceed: ${result.shouldProceed ? "✅ YES" : "❌ NO"}`);

  if (result.issues && result.issues.length > 0) {
    lines.push("\n⚠️  Issues:");
    result.issues.forEach((issue) => lines.push(`  - ${issue}`));
  }

  if (result.warnings && result.warnings.length > 0) {
    lines.push("\n⚡ Warnings:");
    result.warnings.forEach((warning) => lines.push(`  - ${warning}`));
  }

  if (result.saferAlternatives && result.saferAlternatives.length > 0) {
    lines.push("\n💡 Safer Alternatives:");
    result.saferAlternatives.forEach((alt) => lines.push(`  - ${alt}`));
  }

  return lines.join("\n");
}
