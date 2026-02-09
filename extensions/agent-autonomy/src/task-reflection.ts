/**
 * Task reflection: self-review pattern for quality assurance before submission.
 * Agents check their own output for completeness and potential errors.
 */

import type { ValidationResult } from "./types.js";

export type TaskReflectionInput = {
  taskDescription: string;
  result: string;
  success: boolean;
  error?: string;
};

export type TaskReflectionResult = ValidationResult & {
  suggestions?: string[];
  needsRevision?: boolean;
};

/**
 * Perform a self-reflection check on a task result before submission.
 * This is a lightweight, rule-based check that catches common issues.
 */
export function reflectOnTaskResult(input: TaskReflectionInput): TaskReflectionResult {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let confidence = 1.0;
  let needsRevision = false;

  // Rule 1: Check if result is too short (likely incomplete)
  if (input.success && input.result.trim().length < 20) {
    issues.push("Result summary is very short");
    suggestions.push("Provide more detail about what was accomplished");
    confidence *= 0.6;
    needsRevision = true;
  }

  // Rule 2: Check for placeholder text
  const placeholderPatterns = [/TODO/i, /FIXME/i, /\[placeholder\]/i, /\[TBD\]/i, /xxx/i, /\.\.\./];
  for (const pattern of placeholderPatterns) {
    if (pattern.test(input.result)) {
      issues.push(`Result contains placeholder text: ${pattern.toString()}`);
      suggestions.push("Complete all sections before submitting");
      confidence *= 0.7;
      needsRevision = true;
      break;
    }
  }

  // Rule 3: Check for error indicators in successful results
  if (input.success) {
    const errorPatterns = [
      /failed to/i,
      /could not/i,
      /unable to/i,
      /error:/i,
      /exception/i,
      /not found/i,
      /permission denied/i,
    ];
    for (const pattern of errorPatterns) {
      if (pattern.test(input.result)) {
        issues.push(`Result contains error indicators despite success=true: ${pattern.toString()}`);
        suggestions.push(
          "Verify the task actually succeeded, or set success=false if there were errors",
        );
        confidence *= 0.5;
        break;
      }
    }
  }

  // Rule 4: Check if error message is provided when success=false
  if (!input.success && !input.error) {
    issues.push("Task marked as failed but no error message provided");
    suggestions.push("Include an error message explaining what went wrong");
    confidence *= 0.8;
  }

  // Rule 5: Check result addresses task requirements
  // Extract key action words from task description
  const actionWords = extractActionWords(input.taskDescription);
  if (actionWords.length > 0 && input.success) {
    const resultLower = input.result.toLowerCase();
    const missingActions = actionWords.filter((word) => !resultLower.includes(word.toLowerCase()));

    if (missingActions.length === actionWords.length) {
      // None of the key actions are mentioned in the result
      issues.push("Result doesn't appear to address the task requirements");
      suggestions.push(
        `Ensure the result explains how these were handled: ${missingActions.join(", ")}`,
      );
      confidence *= 0.6;
      needsRevision = true;
    }
  }

  // Rule 6: Check for very long results (might need summarization)
  if (input.result.length > 2000) {
    issues.push("Result is very long (>2000 chars)");
    suggestions.push("Consider summarizing the key points for clarity");
    confidence *= 0.9;
  }

  // Rule 7: Check for contradictions
  if (input.success && input.error) {
    issues.push("Task marked as successful but has an error message");
    suggestions.push("Clarify the task status - either success or error, not both");
    confidence *= 0.5;
    needsRevision = true;
  }

  const valid = !needsRevision && issues.length === 0;

  return {
    valid,
    confidence,
    issues,
    suggestions,
    needsRevision,
    suggestedAction: needsRevision ? "modify_params" : undefined,
  };
}

/**
 * Extract key action words from task description to check against result.
 */
function extractActionWords(taskDescription: string): string[] {
  const actionVerbs = [
    "create",
    "build",
    "implement",
    "fix",
    "update",
    "delete",
    "modify",
    "analyze",
    "test",
    "deploy",
    "configure",
    "install",
    "remove",
    "add",
    "change",
    "improve",
    "optimize",
    "refactor",
    "debug",
    "investigate",
    "research",
    "document",
    "review",
    "validate",
  ];

  const words: string[] = [];
  const descLower = taskDescription.toLowerCase();

  for (const verb of actionVerbs) {
    if (descLower.includes(verb)) {
      words.push(verb);
    }
  }

  return words;
}
