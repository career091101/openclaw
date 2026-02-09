/**
 * Tests for agent handoff executor.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createHandoffContext, getHandoffContext, updateHandoffState } from "./executor.js";
import { registerAgent, clearRegistry } from "./registry.js";

describe("Handoff Executor", () => {
  beforeEach(() => {
    clearRegistry();
    registerAgent({
      id: "test-specialist",
      name: "Test Specialist",
      description: "A test specialist agent",
      tags: ["test"],
    });
  });

  it("should create a handoff context", () => {
    const context = createHandoffContext({
      originSessionKey: "agent:main:123",
      targetAgentId: "test-specialist",
      reason: "Testing handoff",
      sharedState: { foo: "bar" },
    });

    expect(context.handoffId).toBeDefined();
    expect(context.originSessionKey).toBe("agent:main:123");
    expect(context.agentStack).toContain("agent:main:123");
    expect(context.agentStack).toContain("test-specialist");
    expect(context.reason).toBe("Testing handoff");
    expect(context.sharedState.foo).toBe("bar");
  });

  it("should retrieve a handoff context", () => {
    const context = createHandoffContext({
      originSessionKey: "agent:main:123",
      targetAgentId: "test-specialist",
      reason: "Testing handoff",
    });

    const retrieved = getHandoffContext(context.handoffId);
    expect(retrieved).toEqual(context);
  });

  it("should update handoff shared state", () => {
    const context = createHandoffContext({
      originSessionKey: "agent:main:123",
      targetAgentId: "test-specialist",
      reason: "Testing handoff",
      sharedState: { foo: "bar" },
    });

    const success = updateHandoffState(context.handoffId, { baz: "qux" });
    expect(success).toBe(true);

    const updated = getHandoffContext(context.handoffId);
    expect(updated?.sharedState.foo).toBe("bar");
    expect(updated?.sharedState.baz).toBe("qux");
  });

  it("should return false when updating non-existent handoff", () => {
    const success = updateHandoffState("nonexistent", { foo: "bar" });
    expect(success).toBe(false);
  });

  it("should return undefined for non-existent handoff context", () => {
    const context = getHandoffContext("nonexistent");
    expect(context).toBeUndefined();
  });
});
