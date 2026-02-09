/**
 * Confidence-based escalation: tracks agent certainty across tool calls and decisions.
 * When aggregate confidence drops below a threshold, automatically pause and request
 * human input before proceeding. Prevents cascading errors from low-confidence paths.
 */

export type ConfidenceScore = {
  toolName: string;
  toolCallId: string;
  confidence: number;
  timestamp: number;
  sessionKey: string;
};

export type ConfidenceState = {
  scores: ConfidenceScore[];
  threshold: number;
  windowSize: number;
  escalated: boolean;
};

export type ConfidenceEscalation = {
  /** Record a confidence score from a tool call or decision. */
  recordConfidence(params: {
    toolName: string;
    toolCallId: string;
    confidence: number;
    sessionKey?: string;
  }): void;

  /** Get the current aggregate confidence for a session. */
  getAggregateConfidence(sessionKey?: string): number;

  /** Check if confidence has dropped below threshold and escalation is needed. */
  shouldEscalate(sessionKey?: string): boolean;

  /** Inject escalation warning; returns prependContext for before_agent_start hook. */
  injectEscalationWarning(sessionKey?: string): { prependContext: string } | undefined;

  /** Mark that escalation has occurred (to avoid repeated warnings). */
  markEscalated(sessionKey?: string): void;

  /** Reset escalation state after human intervention. */
  resetEscalation(sessionKey?: string): void;

  /** Clear all state for a session. */
  clearSession(sessionKey: string): void;
};

const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_WINDOW_SIZE = 5; // Number of recent scores to consider
const SCORE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createConfidenceEscalation(options?: {
  threshold?: number;
  windowSize?: number;
}): ConfidenceEscalation {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
  const sessionStates = new Map<string, ConfidenceState>();

  function getOrCreateState(sessionKey: string): ConfidenceState {
    let state = sessionStates.get(sessionKey);
    if (!state) {
      state = {
        scores: [],
        threshold,
        windowSize,
        escalated: false,
      };
      sessionStates.set(sessionKey, state);
    }
    return state;
  }

  function pruneOldScores(state: ConfidenceState): void {
    const cutoff = Date.now() - SCORE_TTL_MS;
    state.scores = state.scores.filter((s) => s.timestamp > cutoff);
  }

  function calculateAggregate(state: ConfidenceState): number {
    pruneOldScores(state);

    if (state.scores.length === 0) {
      return 1.0; // Default to high confidence if no data
    }

    // Take the most recent N scores (windowing)
    const recentScores = state.scores.slice(-state.windowSize);

    // Calculate weighted average (more recent = higher weight)
    let weightedSum = 0;
    let totalWeight = 0;

    recentScores.forEach((score, index) => {
      const weight = index + 1; // Linear weighting: older scores get lower weight
      weightedSum += score.confidence * weight;
      totalWeight += weight;
    });

    return totalWeight > 0 ? weightedSum / totalWeight : 1.0;
  }

  return {
    recordConfidence(params) {
      const sessionKey = params.sessionKey ?? "__default__";
      const state = getOrCreateState(sessionKey);

      state.scores.push({
        toolName: params.toolName,
        toolCallId: params.toolCallId,
        confidence: params.confidence,
        timestamp: Date.now(),
        sessionKey,
      });

      pruneOldScores(state);
    },

    getAggregateConfidence(sessionKey) {
      const key = sessionKey ?? "__default__";
      const state = getOrCreateState(key);
      return calculateAggregate(state);
    },

    shouldEscalate(sessionKey) {
      const key = sessionKey ?? "__default__";
      const state = getOrCreateState(key);

      if (state.escalated) {
        return false; // Already escalated, don't trigger again
      }

      const aggregate = calculateAggregate(state);
      return aggregate < state.threshold && state.scores.length >= 2;
    },

    injectEscalationWarning(sessionKey) {
      const key = sessionKey ?? "__default__";
      const state = getOrCreateState(key);

      if (!this.shouldEscalate(key)) {
        return undefined;
      }

      const aggregate = calculateAggregate(state);
      const recentScores = state.scores.slice(-state.windowSize);

      const scoreDetails = recentScores
        .map((s) => `  - ${s.toolName}: ${(s.confidence * 100).toFixed(0)}%`)
        .join("\n");

      const prependContext = `
## ⚠️ Low Confidence Alert

Your aggregate confidence has dropped to ${(aggregate * 100).toFixed(0)}%, below the threshold of ${(state.threshold * 100).toFixed(0)}%.

Recent confidence scores:
${scoreDetails}

**Action Required**: Before proceeding with additional tool calls, please:
1. Review your recent decisions and outputs
2. Consider if you have sufficient information to continue
3. If uncertain, ask the user for clarification or guidance
4. Use the \`memory_search\` tool if you need to recall relevant context

Proceeding with low confidence may lead to cascading errors and wasted tokens.
`;

      return { prependContext };
    },

    markEscalated(sessionKey) {
      const key = sessionKey ?? "__default__";
      const state = getOrCreateState(key);
      state.escalated = true;
    },

    resetEscalation(sessionKey) {
      const key = sessionKey ?? "__default__";
      const state = getOrCreateState(key);
      state.escalated = false;
      state.scores = []; // Clear scores to start fresh
    },

    clearSession(sessionKey) {
      sessionStates.delete(sessionKey);
    },
  };
}
