/**
 * Tripwire mechanism: monitors resource usage and triggers alerts/stops
 * when thresholds are exceeded during orchestration.
 */

import { emitDiagnosticEvent } from "openclaw/plugin-sdk";

export type TripwireConfig = {
  maxCostUsd?: number;
  maxTokens?: number;
  maxDurationMinutes?: number;
};

export type TripwireState = {
  totalCostUsd: number;
  totalTokens: number;
  startedAt: number;
  triggered: boolean;
  triggeredMetric?: "cost" | "tokens" | "time";
  triggeredValue?: number;
  triggeredThreshold?: number;
};

export type TripwireCheckResult = {
  ok: boolean;
  metric?: "cost" | "tokens" | "time";
  value?: number;
  threshold?: number;
  message?: string;
};

export type TripwireMonitor = {
  /** Check resource usage from an event and update internal state. */
  checkUsage(event: Record<string, unknown>): TripwireCheckResult;
  /** Configure tripwire thresholds for an orchestration. */
  configure(orchestrationId: string, config: TripwireConfig): void;
  /** Get current state for an orchestration. */
  getState(orchestrationId: string): TripwireState | undefined;
  /** Reset state for an orchestration. */
  reset(orchestrationId: string): void;
};

export function createTripwireMonitor(): TripwireMonitor {
  const states = new Map<string, TripwireState>();
  const configs = new Map<string, TripwireConfig>();

  function getOrCreateState(orchestrationId: string): TripwireState {
    let state = states.get(orchestrationId);
    if (!state) {
      state = {
        totalCostUsd: 0,
        totalTokens: 0,
        startedAt: Date.now(),
        triggered: false,
      };
      states.set(orchestrationId, state);
    }
    return state;
  }

  function checkThresholds(orchestrationId: string, state: TripwireState): TripwireCheckResult {
    const config = configs.get(orchestrationId);
    if (!config) {
      return { ok: true };
    }

    // Check cost threshold
    if (config.maxCostUsd != null && state.totalCostUsd >= config.maxCostUsd) {
      const result: TripwireCheckResult = {
        ok: false,
        metric: "cost",
        value: state.totalCostUsd,
        threshold: config.maxCostUsd,
        message: `cost threshold exceeded: $${state.totalCostUsd.toFixed(4)} >= $${config.maxCostUsd}`,
      };
      state.triggered = true;
      state.triggeredMetric = "cost";
      state.triggeredValue = state.totalCostUsd;
      state.triggeredThreshold = config.maxCostUsd;
      emitTripwireEvent(orchestrationId, result);
      return result;
    }

    // Check token threshold
    if (config.maxTokens != null && state.totalTokens >= config.maxTokens) {
      const result: TripwireCheckResult = {
        ok: false,
        metric: "tokens",
        value: state.totalTokens,
        threshold: config.maxTokens,
        message: `token threshold exceeded: ${state.totalTokens} >= ${config.maxTokens}`,
      };
      state.triggered = true;
      state.triggeredMetric = "tokens";
      state.triggeredValue = state.totalTokens;
      state.triggeredThreshold = config.maxTokens;
      emitTripwireEvent(orchestrationId, result);
      return result;
    }

    // Check duration threshold
    if (config.maxDurationMinutes != null) {
      const elapsedMinutes = (Date.now() - state.startedAt) / (60 * 1000);
      if (elapsedMinutes >= config.maxDurationMinutes) {
        const result: TripwireCheckResult = {
          ok: false,
          metric: "time",
          value: elapsedMinutes,
          threshold: config.maxDurationMinutes,
          message: `duration threshold exceeded: ${elapsedMinutes.toFixed(1)}min >= ${config.maxDurationMinutes}min`,
        };
        state.triggered = true;
        state.triggeredMetric = "time";
        state.triggeredValue = elapsedMinutes;
        state.triggeredThreshold = config.maxDurationMinutes;
        emitTripwireEvent(orchestrationId, result);
        return result;
      }
    }

    return { ok: true };
  }

  function emitTripwireEvent(orchestrationId: string, result: TripwireCheckResult): void {
    try {
      emitDiagnosticEvent({
        type: "orchestration.tripwire",
        orchestrationId,
        metric: result.metric!,
        value: result.value!,
        threshold: result.threshold!,
        action: "paused",
      });
    } catch {
      // Diagnostic event emission is best-effort
    }
  }

  return {
    checkUsage(event) {
      // Extract orchestration context from the event
      const orchestrationId =
        typeof event.orchestrationId === "string" ? event.orchestrationId : undefined;
      if (!orchestrationId) {
        return { ok: true };
      }

      const state = getOrCreateState(orchestrationId);
      if (state.triggered) {
        return {
          ok: false,
          metric: state.triggeredMetric,
          value: state.triggeredValue,
          threshold: state.triggeredThreshold,
          message: "tripwire already triggered",
        };
      }

      // Accumulate usage
      if (typeof event.costUsd === "number") {
        state.totalCostUsd += event.costUsd;
      }
      if (typeof event.tokens === "number") {
        state.totalTokens += event.tokens;
      }

      return checkThresholds(orchestrationId, state);
    },

    configure(orchestrationId, config) {
      configs.set(orchestrationId, config);
      getOrCreateState(orchestrationId);
    },

    getState(orchestrationId) {
      return states.get(orchestrationId);
    },

    reset(orchestrationId) {
      states.delete(orchestrationId);
      configs.delete(orchestrationId);
    },
  };
}
