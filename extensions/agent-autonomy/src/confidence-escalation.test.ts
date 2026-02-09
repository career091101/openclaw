import { describe, it, expect, beforeEach, vi } from "vitest";
import { createConfidenceEscalation } from "./confidence-escalation.js";

describe("createConfidenceEscalation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("should return high confidence (1.0) when no scores recorded", () => {
    const escalation = createConfidenceEscalation();
    expect(escalation.getAggregateConfidence()).toBe(1.0);
  });

  it("should calculate aggregate confidence from recent scores", () => {
    const escalation = createConfidenceEscalation({ windowSize: 3 });

    escalation.recordConfidence({
      toolName: "read",
      toolCallId: "call_1",
      confidence: 0.9,
    });

    escalation.recordConfidence({
      toolName: "write",
      toolCallId: "call_2",
      confidence: 0.7,
    });

    escalation.recordConfidence({
      toolName: "exec",
      toolCallId: "call_3",
      confidence: 0.5,
    });

    const aggregate = escalation.getAggregateConfidence();

    // Weighted average: (0.9*1 + 0.7*2 + 0.5*3) / (1+2+3) = 3.8/6 ≈ 0.633
    expect(aggregate).toBeCloseTo(0.633, 2);
  });

  it("should only consider windowSize most recent scores", () => {
    const escalation = createConfidenceEscalation({ windowSize: 2 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.3, // This should be excluded (oldest)
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.8,
    });

    escalation.recordConfidence({
      toolName: "tool3",
      toolCallId: "call_3",
      confidence: 0.6,
    });

    const aggregate = escalation.getAggregateConfidence();

    // Only last 2 scores: (0.8*1 + 0.6*2) / (1+2) = 2.0/3 ≈ 0.667
    expect(aggregate).toBeCloseTo(0.667, 2);
  });

  it("should trigger escalation when confidence drops below threshold", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.5,
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.4,
    });

    expect(escalation.shouldEscalate()).toBe(true);
  });

  it("should not trigger escalation with only one score", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.3,
    });

    expect(escalation.shouldEscalate()).toBe(false);
  });

  it("should not trigger escalation when above threshold", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.8,
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.9,
    });

    expect(escalation.shouldEscalate()).toBe(false);
  });

  it("should inject escalation warning when confidence is low", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6, windowSize: 2 });

    escalation.recordConfidence({
      toolName: "read",
      toolCallId: "call_1",
      confidence: 0.5,
    });

    escalation.recordConfidence({
      toolName: "write",
      toolCallId: "call_2",
      confidence: 0.4,
    });

    const warning = escalation.injectEscalationWarning();

    expect(warning).toBeDefined();
    expect(warning?.prependContext).toContain("Low Confidence Alert");
    expect(warning?.prependContext).toContain("read: 50%");
    expect(warning?.prependContext).toContain("write: 40%");
  });

  it("should not inject warning when confidence is acceptable", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.8,
    });

    const warning = escalation.injectEscalationWarning();
    expect(warning).toBeUndefined();
  });

  it("should prevent repeated escalations until reset", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.4,
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.3,
    });

    expect(escalation.shouldEscalate()).toBe(true);

    escalation.markEscalated();

    expect(escalation.shouldEscalate()).toBe(false);

    // Even adding more low scores shouldn't trigger
    escalation.recordConfidence({
      toolName: "tool3",
      toolCallId: "call_3",
      confidence: 0.2,
    });

    expect(escalation.shouldEscalate()).toBe(false);
  });

  it("should reset escalation state and clear scores", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.4,
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.3,
    });

    escalation.markEscalated();

    escalation.resetEscalation();

    // After reset, should return to high confidence
    expect(escalation.getAggregateConfidence()).toBe(1.0);
    expect(escalation.shouldEscalate()).toBe(false);
  });

  it("should prune old scores after TTL", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.3,
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.4,
    });

    expect(escalation.shouldEscalate()).toBe(true);

    // Advance time by 11 minutes (past TTL)
    vi.advanceTimersByTime(11 * 60 * 1000);

    // Old scores should be pruned, confidence should reset to 1.0
    expect(escalation.getAggregateConfidence()).toBe(1.0);
    expect(escalation.shouldEscalate()).toBe(false);
  });

  it("should handle multiple sessions independently", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.3,
      sessionKey: "session_a",
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.4,
      sessionKey: "session_a",
    });

    escalation.recordConfidence({
      toolName: "tool3",
      toolCallId: "call_3",
      confidence: 0.9,
      sessionKey: "session_b",
    });

    escalation.recordConfidence({
      toolName: "tool4",
      toolCallId: "call_4",
      confidence: 0.8,
      sessionKey: "session_b",
    });

    expect(escalation.shouldEscalate("session_a")).toBe(true);
    expect(escalation.shouldEscalate("session_b")).toBe(false);
  });

  it("should clear session state independently", () => {
    const escalation = createConfidenceEscalation({ threshold: 0.6 });

    escalation.recordConfidence({
      toolName: "tool1",
      toolCallId: "call_1",
      confidence: 0.3,
      sessionKey: "session_a",
    });

    escalation.recordConfidence({
      toolName: "tool2",
      toolCallId: "call_2",
      confidence: 0.3,
      sessionKey: "session_b",
    });

    escalation.clearSession("session_a");

    expect(escalation.getAggregateConfidence("session_a")).toBe(1.0);
    expect(escalation.getAggregateConfidence("session_b")).toBeLessThan(0.6);
  });
});
