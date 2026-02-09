import { describe, expect, it } from "vitest";
import { createRetryWrapper } from "./retry-wrapper.js";

describe("createRetryWrapper", () => {
  it("records failures and injects retry context", () => {
    const wrapper = createRetryWrapper({ maxRetries: 2 });

    wrapper.recordFailure({
      toolName: "exec",
      toolCallId: "call_1",
      error: "ECONNREFUSED 127.0.0.1:3000",
      sessionKey: "test-session",
    });

    const result = wrapper.injectRetryContext();
    expect(result).toBeDefined();
    expect(result!.prependContext).toContain("Self-correction");
    expect(result!.prependContext).toContain("exec");
    expect(result!.prependContext).toContain("ECONNREFUSED");
  });

  it("respects maxRetries limit", () => {
    const wrapper = createRetryWrapper({ maxRetries: 1 });

    wrapper.recordFailure({
      toolName: "exec",
      toolCallId: "call_1",
      error: "timeout",
      sessionKey: "s1",
    });
    wrapper.recordFailure({
      toolName: "exec",
      toolCallId: "call_1",
      error: "timeout again",
      sessionKey: "s1",
    });

    const result = wrapper.injectRetryContext();
    expect(result).toBeDefined();
    // Should only have 1 record (maxRetries = 1)
    expect(result!.prependContext).toContain("attempt 1/1");
  });

  it("returns undefined when no failures recorded", () => {
    const wrapper = createRetryWrapper();
    const result = wrapper.injectRetryContext();
    expect(result).toBeUndefined();
  });

  it("clears session records", () => {
    const wrapper = createRetryWrapper();
    wrapper.recordFailure({
      toolName: "read",
      toolCallId: "call_2",
      error: "ENOENT",
      sessionKey: "s1",
    });
    wrapper.clearSession("s1");

    const result = wrapper.injectRetryContext();
    expect(result).toBeUndefined();
  });

  it("includes strategy hint in context", () => {
    const wrapper = createRetryWrapper();
    wrapper.recordFailure({
      toolName: "web_fetch",
      toolCallId: "call_3",
      error: "403 Forbidden",
      sessionKey: "s1",
    });

    const result = wrapper.injectRetryContext();
    expect(result).toBeDefined();
    expect(result!.prependContext).toContain("alternative");
  });
});
