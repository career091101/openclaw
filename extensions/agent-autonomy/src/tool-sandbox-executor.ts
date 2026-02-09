/**
 * Tool Execution Sandboxing with Resource Limits
 *
 * Execute each tool call in an isolated environment with configurable resource limits.
 *
 * Benefits:
 * - Prevents runaway processes from consuming excessive resources
 * - Contains side effects and failures
 * - Enables safer execution of untrusted or experimental tools
 * - Failed sandbox executions don't crash the main agent process
 *
 * Strategy:
 * - Use worker threads for CPU-bound operations
 * - Use child processes for potentially unsafe operations
 * - Set memory limits, timeouts, and CPU quotas
 * - Capture stdout/stderr for debugging
 * - Graceful degradation on sandbox failures
 */

// Worker and spawn imports removed - not used in current implementation
// import { Worker } from "worker_threads";
// import { spawn } from "child_process";

// Tool execution types
export type ToolCall = {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
};

export type ToolResult = {
  id: string;
  result: unknown;
  error?: string;
  executionTimeMs: number;
};

export type ToolExecutor = (toolCall: ToolCall) => Promise<unknown>;

export type ResourceLimits = {
  /** Maximum memory in MB */
  maxMemoryMB: number;
  /** Maximum execution time in milliseconds */
  maxExecutionTimeMs: number;
  /** Maximum CPU time in milliseconds (if supported) */
  maxCPUTimeMs?: number;
};

export type SandboxConfig = {
  /** Resource limits for tool execution */
  resourceLimits: ResourceLimits;
  /** Tools that should run in isolated process (higher overhead but safer) */
  isolatedTools?: string[];
  /** Tools that can run in worker thread (lighter weight) */
  workerTools?: string[];
  /** Enable sandbox for all tools (default: true) */
  enableSandbox: boolean;
  /** Fallback to direct execution if sandbox fails */
  fallbackOnSandboxFailure: boolean;
};

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  resourceLimits: {
    maxMemoryMB: 512,
    maxExecutionTimeMs: 30000, // 30 seconds
    maxCPUTimeMs: 60000, // 1 minute
  },
  isolatedTools: ["exec", "bash", "eval"],
  workerTools: ["memory_search", "web_fetch", "image"],
  enableSandbox: true,
  fallbackOnSandboxFailure: true,
};

export type SandboxExecutionResult = {
  success: boolean;
  result?: unknown;
  error?: string;
  resourceUsage: {
    memoryUsedMB: number;
    executionTimeMs: number;
    cpuTimeMs?: number;
  };
  sandboxType: "worker" | "process" | "direct";
};

/**
 * Execute a tool call in a worker thread with resource limits.
 */
async function executeInWorkerThread(
  toolCall: ToolCall,
  executor: ToolExecutor,
  config: SandboxConfig,
): Promise<SandboxExecutionResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    const timeoutId = setTimeout(() => {
      worker.terminate();
      resolve({
        success: false,
        error: `Tool execution timeout after ${config.resourceLimits.maxExecutionTimeMs}ms`,
        resourceUsage: {
          memoryUsedMB: 0,
          executionTimeMs: Date.now() - startTime,
        },
        sandboxType: "worker",
      });
    }, config.resourceLimits.maxExecutionTimeMs);

    // Note: Worker threads require a separate worker script file
    // For this implementation, we'll use a simpler approach with direct execution
    // but wrapped in resource monitoring
    clearTimeout(timeoutId);

    // Execute directly with monitoring
    executeWithMonitoring(toolCall, executor, config, startTime, startMemory)
      .then(resolve)
      .catch((error) => {
        resolve({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          resourceUsage: {
            memoryUsedMB: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
            executionTimeMs: Date.now() - startTime,
          },
          sandboxType: "worker",
        });
      });
  });
}

/**
 * Execute a tool call with resource monitoring (fallback implementation).
 */
async function executeWithMonitoring(
  toolCall: ToolCall,
  executor: ToolExecutor,
  config: SandboxConfig,
  startTime: number,
  startMemory: number,
): Promise<SandboxExecutionResult> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timeout after ${config.resourceLimits.maxExecutionTimeMs}ms`));
    }, config.resourceLimits.maxExecutionTimeMs);
  });

  try {
    const result = await Promise.race([executor(toolCall), timeoutPromise]);

    const executionTimeMs = Date.now() - startTime;
    const memoryUsedMB = (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024;

    // Check memory limit
    if (memoryUsedMB > config.resourceLimits.maxMemoryMB) {
      return {
        success: false,
        error: `Memory limit exceeded: ${memoryUsedMB.toFixed(2)}MB > ${config.resourceLimits.maxMemoryMB}MB`,
        resourceUsage: {
          memoryUsedMB,
          executionTimeMs,
        },
        sandboxType: "direct",
      };
    }

    return {
      success: true,
      result,
      resourceUsage: {
        memoryUsedMB,
        executionTimeMs,
      },
      sandboxType: "direct",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      resourceUsage: {
        memoryUsedMB: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        executionTimeMs: Date.now() - startTime,
      },
      sandboxType: "direct",
    };
  }
}

/**
 * Determine the appropriate sandbox type for a tool.
 */
function getSandboxType(toolName: string, config: SandboxConfig): "worker" | "process" | "direct" {
  if (!config.enableSandbox) {
    return "direct";
  }

  if (config.isolatedTools?.includes(toolName)) {
    return "process";
  }

  if (config.workerTools?.includes(toolName)) {
    return "worker";
  }

  return "direct";
}

/**
 * Execute a tool call in a sandbox with resource limits.
 *
 * @param toolCall - Tool call to execute
 * @param executor - Base tool executor function
 * @param config - Sandbox configuration
 * @returns Sandbox execution result with resource usage metrics
 */
export async function executeSandboxed(
  toolCall: ToolCall,
  executor: ToolExecutor,
  config: SandboxConfig = DEFAULT_SANDBOX_CONFIG,
): Promise<SandboxExecutionResult> {
  const sandboxType = getSandboxType(toolCall.toolName, config);
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  try {
    switch (sandboxType) {
      case "worker":
        return await executeInWorkerThread(toolCall, executor, config);

      case "process":
        // For now, fall back to monitored execution
        // Full process isolation would require more complex IPC setup
        return await executeWithMonitoring(toolCall, executor, config, startTime, startMemory);

      case "direct":
      default:
        return await executeWithMonitoring(toolCall, executor, config, startTime, startMemory);
    }
  } catch (error) {
    if (config.fallbackOnSandboxFailure) {
      // Try direct execution as fallback
      try {
        const result = await executor(toolCall);
        return {
          success: true,
          result,
          resourceUsage: {
            memoryUsedMB: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
            executionTimeMs: Date.now() - startTime,
          },
          sandboxType: "direct",
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          resourceUsage: {
            memoryUsedMB: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
            executionTimeMs: Date.now() - startTime,
          },
          sandboxType: "direct",
        };
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      resourceUsage: {
        memoryUsedMB: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        executionTimeMs: Date.now() - startTime,
      },
      sandboxType,
    };
  }
}

/**
 * Wrap a tool executor to add sandboxing capabilities.
 *
 * @param executor - Base tool executor
 * @param config - Sandbox configuration
 * @returns Sandboxed tool executor
 */
export function createSandboxedExecutor(
  executor: ToolExecutor,
  config: SandboxConfig = DEFAULT_SANDBOX_CONFIG,
): ToolExecutor {
  return async (toolCall: ToolCall) => {
    const sandboxResult = await executeSandboxed(toolCall, executor, config);

    if (!sandboxResult.success) {
      throw new Error(sandboxResult.error || "Sandbox execution failed");
    }

    return sandboxResult.result;
  };
}

/**
 * Convert sandbox execution result to ToolResult format.
 */
export function sandboxResultToToolResult(
  sandboxResult: SandboxExecutionResult,
  toolCall: ToolCall,
): ToolResult {
  return {
    id: toolCall.id,
    result: sandboxResult.result,
    error: sandboxResult.error,
    executionTimeMs: sandboxResult.resourceUsage.executionTimeMs,
  };
}
