/**
 * Retry wrapper: injects retry context into the agent's next prompt.
 * Does NOT automatically re-execute tools — the agent decides what to do.
 * Uses `before_agent_start` hook to provide context about prior failures.
 */

import { classifyError } from "./error-classifier.js";

type RetryRecord = {
  toolName: string;
  toolCallId: string;
  error: string;
  classification: ReturnType<typeof classifyError>;
  attempt: number;
  timestamp: number;
};

type RetryState = {
  records: Map<string, RetryRecord[]>;
  maxRetries: number;
};

export type RetryWrapper = {
  /** Record a tool failure for potential retry context injection. */
  recordFailure(params: {
    toolName: string;
    toolCallId: string;
    error: string;
    sessionKey?: string;
  }): void;

  /** Inject retry context; returns prependContext for the before_agent_start hook. */
  injectRetryContext(): { prependContext: string } | undefined;

  /** Clear retry records for a session. */
  clearSession(sessionKey: string): void;
};

const DEFAULT_MAX_RETRIES = 2;
const RECORD_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function createRetryWrapper(options?: { maxRetries?: number }): RetryWrapper {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sessionStates = new Map<string, RetryState>();

  function getOrCreateState(sessionKey: string): RetryState {
    let state = sessionStates.get(sessionKey);
    if (!state) {
      state = { records: new Map(), maxRetries };
      sessionStates.set(sessionKey, state);
    }
    return state;
  }

  function pruneOldRecords(state: RetryState): void {
    const cutoff = Date.now() - RECORD_TTL_MS;
    for (const [key, records] of state.records) {
      const fresh = records.filter((r) => r.timestamp > cutoff);
      if (fresh.length === 0) {
        state.records.delete(key);
      } else {
        state.records.set(key, fresh);
      }
    }
  }

  return {
    recordFailure(params) {
      const sessionKey = params.sessionKey ?? "__default__";
      const state = getOrCreateState(sessionKey);
      pruneOldRecords(state);

      const key = `${params.toolName}:${params.toolCallId}`;
      const existing = state.records.get(key) ?? [];
      const attempt = existing.length + 1;

      if (attempt > state.maxRetries) {
        // Don't record more than maxRetries
        return;
      }

      const classification = classifyError(params.error);
      existing.push({
        toolName: params.toolName,
        toolCallId: params.toolCallId,
        error: params.error,
        classification,
        attempt,
        timestamp: Date.now(),
      });
      state.records.set(key, existing);
    },

    injectRetryContext() {
      // Collect all active retry records across sessions
      const hints: string[] = [];

      for (const state of sessionStates.values()) {
        pruneOldRecords(state);
        for (const [, records] of state.records) {
          const latest = records[records.length - 1];
          if (!latest) {
            continue;
          }

          const { toolName, error, classification, attempt } = latest;
          const strategyHint =
            classification.suggestedStrategy === "retry_same"
              ? "consider retrying with the same parameters"
              : classification.suggestedStrategy === "modify_params"
                ? "consider adjusting parameters before retrying"
                : classification.suggestedStrategy === "alternative_tool"
                  ? "consider using an alternative approach"
                  : "ask the user for help";

          hints.push(
            `[Self-correction] Tool "${toolName}" failed (attempt ${attempt}/${maxRetries}): ${error}. ` +
              `Category: ${classification.category}. Suggestion: ${strategyHint}.`,
          );
        }
      }

      if (hints.length === 0) {
        return undefined;
      }

      const prependContext = `\n\n## Recent Tool Failures (Self-Correction Context)\n${hints.join("\n")}\n`;
      return { prependContext };
    },

    clearSession(sessionKey) {
      sessionStates.delete(sessionKey);
    },
  };
}
