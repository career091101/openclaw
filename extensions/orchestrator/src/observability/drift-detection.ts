/**
 * Behavioral drift detection: compares agent behavior against a baseline
 * and warns when significant deviations are detected.
 */

export type BehaviorSnapshot = {
  toolCallCounts: Record<string, number>;
  errorRate: number;
  averageDurationMs: number;
  totalCalls: number;
};

export type DriftResult = {
  drifted: boolean;
  score: number; // 0 = no drift, 1 = maximum drift
  details: string[];
};

const DRIFT_THRESHOLD = 0.5;

/**
 * Create an empty behavior snapshot.
 */
export function createEmptySnapshot(): BehaviorSnapshot {
  return {
    toolCallCounts: {},
    errorRate: 0,
    averageDurationMs: 0,
    totalCalls: 0,
  };
}

/**
 * Record a tool call into a behavior snapshot.
 */
export function recordToolCall(
  snapshot: BehaviorSnapshot,
  params: {
    toolName: string;
    durationMs: number;
    hadError: boolean;
  },
): void {
  snapshot.toolCallCounts[params.toolName] = (snapshot.toolCallCounts[params.toolName] ?? 0) + 1;
  snapshot.totalCalls += 1;

  // Update rolling average duration
  const prevTotal = snapshot.averageDurationMs * (snapshot.totalCalls - 1);
  snapshot.averageDurationMs = (prevTotal + params.durationMs) / snapshot.totalCalls;

  // Update error rate
  if (params.hadError) {
    const prevErrors = snapshot.errorRate * (snapshot.totalCalls - 1);
    snapshot.errorRate = (prevErrors + 1) / snapshot.totalCalls;
  } else {
    const prevErrors = snapshot.errorRate * (snapshot.totalCalls - 1);
    snapshot.errorRate = prevErrors / snapshot.totalCalls;
  }
}

/**
 * Compare a current snapshot against a baseline to detect drift.
 */
export function detectDrift(baseline: BehaviorSnapshot, current: BehaviorSnapshot): DriftResult {
  const details: string[] = [];
  let driftScore = 0;
  let comparisons = 0;

  // Compare error rates
  if (baseline.totalCalls > 0 && current.totalCalls > 0) {
    const errorDiff = Math.abs(current.errorRate - baseline.errorRate);
    if (errorDiff > 0.2) {
      details.push(
        `error rate drift: ${(baseline.errorRate * 100).toFixed(1)}% → ${(current.errorRate * 100).toFixed(1)}%`,
      );
      driftScore += errorDiff;
    }
    comparisons += 1;
  }

  // Compare average duration
  if (baseline.averageDurationMs > 0 && current.averageDurationMs > 0) {
    const durationRatio = current.averageDurationMs / baseline.averageDurationMs;
    if (durationRatio > 3 || durationRatio < 0.33) {
      details.push(
        `duration drift: ${baseline.averageDurationMs.toFixed(0)}ms → ${current.averageDurationMs.toFixed(0)}ms`,
      );
      driftScore += Math.min(1, Math.abs(Math.log2(durationRatio)) / 3);
    }
    comparisons += 1;
  }

  // Compare tool usage distribution
  const allTools = new Set([
    ...Object.keys(baseline.toolCallCounts),
    ...Object.keys(current.toolCallCounts),
  ]);
  if (allTools.size > 0 && baseline.totalCalls > 0 && current.totalCalls > 0) {
    let toolDrift = 0;
    for (const tool of allTools) {
      const baselineRatio = (baseline.toolCallCounts[tool] ?? 0) / baseline.totalCalls;
      const currentRatio = (current.toolCallCounts[tool] ?? 0) / current.totalCalls;
      toolDrift += Math.abs(currentRatio - baselineRatio);
    }
    const normalizedToolDrift = toolDrift / allTools.size;
    if (normalizedToolDrift > 0.3) {
      details.push(
        `tool distribution drift: ${(normalizedToolDrift * 100).toFixed(1)}% average deviation`,
      );
      driftScore += normalizedToolDrift;
    }
    comparisons += 1;
  }

  // Normalize drift score
  const normalizedScore = comparisons > 0 ? Math.min(1, driftScore / comparisons) : 0;

  return {
    drifted: normalizedScore >= DRIFT_THRESHOLD,
    score: normalizedScore,
    details,
  };
}
