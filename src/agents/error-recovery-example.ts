/**
 * error-recovery-example.ts
 *
 * Example usage of the error recovery utility in agent operations
 */

import {
  withErrorRecovery,
  createResilientOperation,
  type ErrorRecoveryConfig,
} from "./error-recovery.js";

// Example 1: Wrap a network API call with automatic retry
export async function fetchDataWithRetry(url: string): Promise<unknown> {
  return withErrorRecovery(
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
    },
    `fetch-${url}`,
  );
}

// Example 2: Create a resilient version of an existing async function
export const resilientFetch = createResilientOperation(
  async (url: string, options?: RequestInit) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  },
  { maxRetries: 3 },
  "resilient-fetch",
);

// Example 3: Wrap external tool calls with custom configuration
export async function callExternalToolWithRecovery<T>(
  toolFn: () => Promise<T>,
  toolName: string,
): Promise<T> {
  const config: Partial<ErrorRecoveryConfig> = {
    maxRetries: 5,
    initialDelayMs: 2000,
    maxDelayMs: 60000,
    circuitBreakerThreshold: 10,
  };

  return withErrorRecovery(toolFn, config, `tool-${toolName}`);
}

// Example 4: Usage in agent task execution
export class ResilientAgentTask {
  async execute(taskFn: () => Promise<unknown>): Promise<unknown> {
    try {
      return await withErrorRecovery(
        taskFn,
        {
          maxRetries: 3,
          circuitBreakerThreshold: 5,
        },
        "agent-task",
      );
    } catch (error) {
      // Handle final failure after all retries exhausted
      console.error("Agent task failed after recovery attempts:", error);
      throw error;
    }
  }
}

/**
 * Example: Integrate with OpenClaw's agent execution flow
 *
 * Usage in agent loops:
 *
 * ```typescript
 * const result = await withErrorRecovery(
 *   () => executeTool(toolName, args),
 *   { maxRetries: 3 },
 *   `tool-${toolName}`
 * );
 * ```
 *
 * Or create pre-configured resilient versions:
 *
 * ```typescript
 * const resilientReadFile = createResilientOperation(readFile, { maxRetries: 3 });
 * const resilientExec = createResilientOperation(execCommand, { maxRetries: 5 });
 * ```
 */
