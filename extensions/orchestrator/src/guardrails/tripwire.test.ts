import { describe, expect, it, vi } from "vitest";
import { createTripwireMonitor } from "./tripwire.js";

// Mock the emitDiagnosticEvent
vi.mock("openclaw/plugin-sdk", () => ({
  emitDiagnosticEvent: vi.fn(),
}));

describe("createTripwireMonitor", () => {
  it("returns ok when no thresholds configured", () => {
    const monitor = createTripwireMonitor();
    const result = monitor.checkUsage({
      orchestrationId: "test-1",
      costUsd: 0.05,
      tokens: 1000,
    });
    expect(result.ok).toBe(true);
  });

  it("triggers on cost threshold", () => {
    const monitor = createTripwireMonitor();
    monitor.configure("test-1", { maxCostUsd: 0.1 });

    // First check under threshold
    let result = monitor.checkUsage({
      orchestrationId: "test-1",
      costUsd: 0.05,
      tokens: 500,
    });
    expect(result.ok).toBe(true);

    // Second check crosses threshold
    result = monitor.checkUsage({
      orchestrationId: "test-1",
      costUsd: 0.06,
      tokens: 500,
    });
    expect(result.ok).toBe(false);
    expect(result.metric).toBe("cost");
  });

  it("triggers on token threshold", () => {
    const monitor = createTripwireMonitor();
    monitor.configure("test-1", { maxTokens: 10000 });

    monitor.checkUsage({ orchestrationId: "test-1", tokens: 5000 });
    const result = monitor.checkUsage({ orchestrationId: "test-1", tokens: 6000 });
    expect(result.ok).toBe(false);
    expect(result.metric).toBe("tokens");
  });

  it("remains triggered once tripped", () => {
    const monitor = createTripwireMonitor();
    monitor.configure("test-1", { maxCostUsd: 0.01 });

    monitor.checkUsage({ orchestrationId: "test-1", costUsd: 0.02 });
    const result = monitor.checkUsage({ orchestrationId: "test-1", costUsd: 0 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already triggered");
  });

  it("tracks state per orchestration", () => {
    const monitor = createTripwireMonitor();
    monitor.configure("test-1", { maxCostUsd: 0.1 });
    monitor.configure("test-2", { maxCostUsd: 1.0 });

    monitor.checkUsage({ orchestrationId: "test-1", costUsd: 0.11 });
    const result1 = monitor.getState("test-1");
    const result2 = monitor.getState("test-2");

    expect(result1?.triggered).toBe(true);
    expect(result2?.triggered).toBe(false);
  });

  it("resets state", () => {
    const monitor = createTripwireMonitor();
    monitor.configure("test-1", { maxCostUsd: 0.1 });
    monitor.checkUsage({ orchestrationId: "test-1", costUsd: 0.15 });
    expect(monitor.getState("test-1")?.triggered).toBe(true);

    monitor.reset("test-1");
    expect(monitor.getState("test-1")).toBeUndefined();
  });

  it("ignores events without orchestrationId", () => {
    const monitor = createTripwireMonitor();
    const result = monitor.checkUsage({ costUsd: 100 });
    expect(result.ok).toBe(true);
  });
});
