/**
 * Parallel Tool Execution: Execute independent tool calls simultaneously.
 *
 * Benefits:
 * - Dramatically reduces total execution time for multi-tool workflows
 * - Improves agent responsiveness
 * - Better resource utilization
 *
 * Strategy:
 * - Analyze tool call dependencies
 * - Group independent tools into parallel batches
 * - Execute each batch with Promise.all()
 * - Maintain execution order for dependent tools
 */

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

export type ParallelExecutionConfig = {
  /** Maximum number of tools to execute in parallel */
  maxParallelism: number;
  /** Tools that should never be parallelized (have side effects) */
  sequentialTools?: string[];
  /** Enable dependency detection */
  detectDependencies: boolean;
};

export const DEFAULT_PARALLEL_CONFIG: ParallelExecutionConfig = {
  maxParallelism: 5,
  sequentialTools: [
    "exec",
    "bash",
    "write",
    "edit",
    "delete",
    "memory_write",
    "memory_update",
    "memory_forget",
    "sessions_send",
    "delegate_task",
  ],
  detectDependencies: true,
};

/**
 * Detect if a tool call depends on the results of a previous call.
 * Simple heuristic: check if any parameter values reference the previous tool's id.
 */
function hasDependency(toolCall: ToolCall, previousCalls: ToolCall[]): boolean {
  const paramStr = JSON.stringify(toolCall.params);

  for (const prevCall of previousCalls) {
    // Check if this tool's params reference the previous tool's ID
    // This catches patterns like: { file: "$tool_abc123.result" }
    if (paramStr.includes(prevCall.id)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a tool should always execute sequentially (has side effects).
 */
function isSequentialTool(toolName: string, config: ParallelExecutionConfig): boolean {
  return config.sequentialTools?.includes(toolName) ?? false;
}

/**
 * Group tool calls into batches that can be executed in parallel.
 * Each batch contains only independent tools.
 */
export function groupToolCallsIntoBatches(
  toolCalls: ToolCall[],
  config: ParallelExecutionConfig = DEFAULT_PARALLEL_CONFIG,
): ToolCall[][] {
  const batches: ToolCall[][] = [];
  let currentBatch: ToolCall[] = [];
  const processedCalls: ToolCall[] = [];

  for (const toolCall of toolCalls) {
    const mustBeSequential = isSequentialTool(toolCall.toolName, config);
    const hasDeps = config.detectDependencies && hasDependency(toolCall, processedCalls);

    if (mustBeSequential || hasDeps || currentBatch.length >= config.maxParallelism) {
      // Flush current batch and start new one
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
      }

      // Sequential tools go in their own batch
      if (mustBeSequential || hasDeps) {
        batches.push([toolCall]);
      } else {
        currentBatch.push(toolCall);
      }
    } else {
      // Add to current parallel batch
      currentBatch.push(toolCall);
    }

    processedCalls.push(toolCall);
  }

  // Flush remaining batch
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Execute a batch of tool calls in parallel.
 */
async function executeBatch(batch: ToolCall[], executor: ToolExecutor): Promise<ToolResult[]> {
  const promises = batch.map(async (toolCall) => {
    const callStartTime = Date.now();
    try {
      const result = await executor(toolCall);
      return {
        id: toolCall.id,
        result,
        executionTimeMs: Date.now() - callStartTime,
      };
    } catch (error) {
      return {
        id: toolCall.id,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - callStartTime,
      };
    }
  });

  return Promise.all(promises);
}

/**
 * Execute tool calls with automatic parallelization of independent operations.
 *
 * @param toolCalls - Array of tool calls to execute
 * @param executor - Function that executes a single tool call
 * @param config - Parallel execution configuration
 * @returns Array of tool results in the same order as input
 */
export async function executeToolCallsInParallel(
  toolCalls: ToolCall[],
  executor: ToolExecutor,
  config: ParallelExecutionConfig = DEFAULT_PARALLEL_CONFIG,
): Promise<ToolResult[]> {
  if (toolCalls.length === 0) {
    return [];
  }

  // Group into batches
  const batches = groupToolCallsIntoBatches(toolCalls, config);

  // Execute batches sequentially, but tools within each batch in parallel
  const allResults: ToolResult[] = [];

  for (const batch of batches) {
    const batchResults = await executeBatch(batch, executor);
    allResults.push(...batchResults);
  }

  return allResults;
}

/**
 * Calculate performance improvement from parallelization.
 */
export function calculateSpeedup(
  results: ToolResult[],
  batches: ToolCall[][],
): {
  sequentialTimeMs: number;
  parallelTimeMs: number;
  speedup: number;
  parallelizationRatio: number;
} {
  const sequentialTimeMs = results.reduce((sum, r) => sum + r.executionTimeMs, 0);

  // Parallel time is the sum of the slowest tool in each batch
  const parallelTimeMs = batches.reduce((sum, batch) => {
    const batchIds = new Set(batch.map((t) => t.id));
    const batchResults = results.filter((r) => batchIds.has(r.id));
    const maxBatchTime = Math.max(...batchResults.map((r) => r.executionTimeMs));
    return sum + maxBatchTime;
  }, 0);

  const speedup = sequentialTimeMs > 0 ? sequentialTimeMs / parallelTimeMs : 1.0;
  const parallelizationRatio = batches.filter((b) => b.length > 1).length / batches.length;

  return {
    sequentialTimeMs,
    parallelTimeMs,
    speedup,
    parallelizationRatio,
  };
}
