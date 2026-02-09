/**
 * Continuous Autonomy Loop: Wraps agent execution with verification and retry logic.
 * Inspired by the "Ralph Wiggum technique" - keeps running until the task is actually complete.
 * 
 * Pattern: Instead of executing once and stopping, this creates an outer loop that:
 * 1. Executes the agent/tool loop
 * 2. Verifies if the task is actually complete
 * 3. If not, provides feedback and runs another iteration
 * 4. Stops when verification passes or limits are hit
 */

export type LoopResult<T = unknown> = {
  result: T;
  iterations: number;
  completionReason: "verified" | "max-iterations" | "max-tokens" | "max-cost" | "aborted";
  reason?: string;
  totalTokens?: number;
  totalCost?: number;
  allResults: T[];
};

export type VerificationResult = {
  complete: boolean;
  reason?: string; // Feedback for next iteration if !complete, or explanation if complete
};

export type StopCondition = {
  check: (state: LoopState) => boolean;
  reason: string;
};

export type LoopState = {
  iteration: number;
  totalTokens: number;
  totalCost: number;
  results: unknown[];
};

export type ContinuousLoopOptions<T = unknown> = {
  /** Function to verify if the task is complete */
  verifyCompletion?: (params: {
    result: T;
    iteration: number;
    allResults: T[];
    originalPrompt: string;
  }) => Promise<VerificationResult> | VerificationResult;

  /** Stop conditions (iteration count, token count, cost limit) */
  stopWhen?: StopCondition | StopCondition[];

  /** Called at start of each iteration */
  onIterationStart?: (params: { iteration: number }) => void | Promise<void>;

  /** Called at end of each iteration */
  onIterationEnd?: (params: {
    iteration: number;
    duration: number;
    result: T;
  }) => void | Promise<void>;

  /** Maximum iterations (default: 10) */
  maxIterations?: number;
};

export type ExecuteFunction<T = unknown> = (params: {
  prompt: string;
  feedback?: string;
  iteration: number;
}) => Promise<T>;

/**
 * Stop condition: iteration count
 */
export function iterationCountIs(maxIterations: number): StopCondition {
  return {
    check: (state) => state.iteration >= maxIterations,
    reason: `max-iterations-${maxIterations}`,
  };
}

/**
 * Stop condition: token count
 */
export function tokenCountIs(maxTokens: number): StopCondition {
  return {
    check: (state) => state.totalTokens >= maxTokens,
    reason: `max-tokens-${maxTokens}`,
  };
}

/**
 * Stop condition: cost limit (in USD)
 */
export function costIs(maxCost: number): StopCondition {
  return {
    check: (state) => state.totalCost >= maxCost,
    reason: `max-cost-${maxCost.toFixed(2)}`,
  };
}

/**
 * Continuous autonomy loop wrapper
 */
export async function continuousLoop<T = unknown>(
  executeFunction: ExecuteFunction<T>,
  originalPrompt: string,
  options: ContinuousLoopOptions<T> = {},
): Promise<LoopResult<T>> {
  const {
    verifyCompletion,
    stopWhen = iterationCountIs(options.maxIterations ?? 10),
    onIterationStart,
    onIterationEnd,
  } = options;

  const stopConditions = Array.isArray(stopWhen) ? stopWhen : [stopWhen];
  const state: LoopState = {
    iteration: 0,
    totalTokens: 0,
    totalCost: 0,
    results: [],
  };

  let feedback: string | undefined;

  while (true) {
    state.iteration++;

    // Execute iteration
    await onIterationStart?.({ iteration: state.iteration });
    const startTime = Date.now();

    const result = await executeFunction({
      prompt: originalPrompt,
      feedback,
      iteration: state.iteration,
    });

    const duration = Date.now() - startTime;
    state.results.push(result);

    await onIterationEnd?.({ iteration: state.iteration, duration, result });

    // Update token/cost tracking if result contains usage info
    if (typeof result === "object" && result !== null) {
      const resultObj = result as Record<string, unknown>;
      if (typeof resultObj.usage === "object" && resultObj.usage !== null) {
        const usage = resultObj.usage as Record<string, unknown>;
        if (typeof usage.total_tokens === "number") {
          state.totalTokens += usage.total_tokens;
        }
      }
      if (typeof resultObj.cost === "number") {
        state.totalCost += resultObj.cost;
      }
    }

    // Check stop conditions after executing
    for (const condition of stopConditions) {
      if (condition.check(state)) {
        return {
          result,
          iterations: state.iteration,
          completionReason: condition.reason.startsWith("max-iterations")
            ? "max-iterations"
            : condition.reason.startsWith("max-tokens")
              ? "max-tokens"
              : condition.reason.startsWith("max-cost")
                ? "max-cost"
                : "aborted",
          reason: condition.reason,
          totalTokens: state.totalTokens,
          totalCost: state.totalCost,
          allResults: state.results as T[],
        };
      }
    }

    // Verify completion
    if (verifyCompletion) {
      const verification = await verifyCompletion({
        result,
        iteration: state.iteration,
        allResults: state.results as T[],
        originalPrompt,
      });

      if (verification.complete) {
        return {
          result,
          iterations: state.iteration,
          completionReason: "verified",
          reason: verification.reason,
          totalTokens: state.totalTokens,
          totalCost: state.totalCost,
          allResults: state.results as T[],
        };
      }

      // Not complete - prepare feedback for next iteration
      feedback = verification.reason
        ? `[Verification feedback] ${verification.reason}`
        : undefined;
    } else {
      // No verification function - complete after first iteration
      return {
        result,
        iterations: state.iteration,
        completionReason: "verified",
        totalTokens: state.totalTokens,
        totalCost: state.totalCost,
        allResults: state.results as T[],
      };
    }
  }
}

/**
 * Simplified wrapper for common use case: retry until success or max iterations
 */
export async function retryUntilSuccess<T = unknown>(
  executeFunction: ExecuteFunction<T>,
  prompt: string,
  options: {
    maxIterations?: number;
    isSuccess?: (result: T) => boolean | Promise<boolean>;
  } = {},
): Promise<LoopResult<T>> {
  const { maxIterations = 10, isSuccess = () => true } = options;

  return continuousLoop(executeFunction, prompt, {
    maxIterations,
    verifyCompletion: async ({ result }) => ({
      complete: await isSuccess(result),
      reason: "Retrying to achieve success",
    }),
  });
}
