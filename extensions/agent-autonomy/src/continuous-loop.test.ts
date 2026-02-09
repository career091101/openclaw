import { describe, it, expect, vi } from "vitest";
import {
  continuousLoop,
  retryUntilSuccess,
  iterationCountIs,
  tokenCountIs,
  costIs,
  type ExecuteFunction,
} from "./continuous-loop.js";

describe("continuousLoop", () => {
  it("should complete after first iteration when verification passes", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("success");
    const verify = vi.fn().mockResolvedValue({ complete: true, reason: "All done" });

    const result = await continuousLoop(execute, "test prompt", {
      verifyCompletion: verify,
      maxIterations: 5,
    });

    expect(result.iterations).toBe(1);
    expect(result.completionReason).toBe("verified");
    expect(result.reason).toBe("All done");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("should retry until verification passes", async () => {
    let callCount = 0;
    const execute: ExecuteFunction<string> = vi.fn().mockImplementation(async () => {
      callCount++;
      return `attempt-${callCount}`;
    });

    const verify = vi.fn().mockImplementation(async ({ iteration }) => {
      if (iteration < 3) {
        return { complete: false, reason: "Not done yet" };
      }
      return { complete: true, reason: "Success!" };
    });

    const result = await continuousLoop(execute, "test prompt", {
      verifyCompletion: verify,
      maxIterations: 5,
    });

    expect(result.iterations).toBe(3);
    expect(result.completionReason).toBe("verified");
    expect(result.allResults).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("should stop at max iterations if verification never passes", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("attempt");
    const verify = vi.fn().mockResolvedValue({ complete: false, reason: "Keep trying" });

    const result = await continuousLoop(execute, "test prompt", {
      verifyCompletion: verify,
      maxIterations: 3,
    });

    expect(result.iterations).toBe(3);
    expect(result.completionReason).toBe("max-iterations");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("should inject feedback from failed verification into next iteration", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("result");
    const verify = vi.fn().mockImplementation(async ({ iteration }) => {
      if (iteration === 1) {
        return { complete: false, reason: "Missing required field X" };
      }
      return { complete: true };
    });

    await continuousLoop(execute, "test prompt", {
      verifyCompletion: verify,
      maxIterations: 3,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, {
      prompt: "test prompt",
      feedback: undefined,
      iteration: 1,
    });
    expect(execute).toHaveBeenNthCalledWith(2, {
      prompt: "test prompt",
      feedback: "[Verification feedback] Missing required field X",
      iteration: 2,
    });
  });

  it("should complete after first iteration when no verification function provided", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("success");

    const result = await continuousLoop(execute, "test prompt", {
      maxIterations: 5,
    });

    expect(result.iterations).toBe(1);
    expect(result.completionReason).toBe("verified");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("should call lifecycle hooks", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("result");
    const verify = vi.fn().mockResolvedValue({ complete: true });
    const onStart = vi.fn();
    const onEnd = vi.fn();

    await continuousLoop(execute, "test prompt", {
      verifyCompletion: verify,
      onIterationStart: onStart,
      onIterationEnd: onEnd,
    });

    expect(onStart).toHaveBeenCalledWith({ iteration: 1 });
    expect(onEnd).toHaveBeenCalledWith({
      iteration: 1,
      duration: expect.any(Number),
      result: "result",
    });
  });

  it("should track token usage when result contains usage info", async () => {
    const execute: ExecuteFunction<{ usage: { total_tokens: number } }> = vi
      .fn()
      .mockImplementation(async ({ iteration }) => ({
        usage: { total_tokens: iteration * 100 },
      }));

    const verify = vi.fn().mockImplementation(async ({ iteration }) => ({
      complete: iteration >= 2,
    }));

    const result = await continuousLoop(execute, "test prompt", {
      verifyCompletion: verify,
      maxIterations: 5,
    });

    expect(result.totalTokens).toBe(300); // 100 + 200
    expect(result.iterations).toBe(2);
  });

  it("should track cost when result contains cost info", async () => {
    const execute: ExecuteFunction<{ cost: number }> = vi
      .fn()
      .mockImplementation(async ({ iteration }) => ({
        cost: iteration * 0.01,
      }));

    const verify = vi.fn().mockImplementation(async ({ iteration }) => ({
      complete: iteration >= 2,
    }));

    const result = await continuousLoop(execute, "test prompt", {
      verifyCompletion: verify,
      maxIterations: 5,
    });

    expect(result.totalCost).toBe(0.03); // 0.01 + 0.02
    expect(result.iterations).toBe(2);
  });
});

describe("stop conditions", () => {
  it("should stop when iteration count reached", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("result");
    const verify = vi.fn().mockResolvedValue({ complete: false });

    const result = await continuousLoop(execute, "test", {
      verifyCompletion: verify,
      stopWhen: iterationCountIs(3),
    });

    expect(result.iterations).toBe(3);
    expect(result.completionReason).toBe("max-iterations");
  });

  it("should stop when token count exceeded", async () => {
    const execute: ExecuteFunction<{ usage: { total_tokens: number } }> = vi.fn().mockResolvedValue({
      usage: { total_tokens: 1000 },
    });
    const verify = vi.fn().mockResolvedValue({ complete: false });

    const result = await continuousLoop(execute, "test", {
      verifyCompletion: verify,
      stopWhen: tokenCountIs(2500),
      maxIterations: 10,
    });

    expect(result.iterations).toBe(3); // 1000 + 1000 + 1000 = 3000 > 2500
    expect(result.completionReason).toBe("max-tokens");
  });

  it("should stop when cost limit exceeded", async () => {
    const execute: ExecuteFunction<{ cost: number }> = vi.fn().mockResolvedValue({
      cost: 0.5,
    });
    const verify = vi.fn().mockResolvedValue({ complete: false });

    const result = await continuousLoop(execute, "test", {
      verifyCompletion: verify,
      stopWhen: costIs(1.2),
      maxIterations: 10,
    });

    expect(result.iterations).toBe(3); // 0.5 + 0.5 + 0.5 = 1.5 > 1.2
    expect(result.completionReason).toBe("max-cost");
  });

  it("should handle multiple stop conditions", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("result");
    const verify = vi.fn().mockResolvedValue({ complete: false });

    const result = await continuousLoop(execute, "test", {
      verifyCompletion: verify,
      stopWhen: [iterationCountIs(10), tokenCountIs(10000), costIs(5.0)],
    });

    expect(result.iterations).toBe(10);
    expect(result.completionReason).toBe("max-iterations");
  });
});

describe("retryUntilSuccess", () => {
  it("should retry until isSuccess returns true", async () => {
    let attempt = 0;
    const execute: ExecuteFunction<string> = vi.fn().mockImplementation(async () => {
      attempt++;
      return attempt === 3 ? "SUCCESS" : "FAIL";
    });

    const result = await retryUntilSuccess(execute, "test", {
      maxIterations: 5,
      isSuccess: (res) => res === "SUCCESS",
    });

    expect(result.iterations).toBe(3);
    expect(result.completionReason).toBe("verified");
    expect(result.result).toBe("SUCCESS");
  });

  it("should stop at max iterations if success never achieved", async () => {
    const execute: ExecuteFunction<string> = vi.fn().mockResolvedValue("FAIL");

    const result = await retryUntilSuccess(execute, "test", {
      maxIterations: 3,
      isSuccess: (res) => res === "SUCCESS",
    });

    expect(result.iterations).toBe(3);
    expect(result.completionReason).toBe("max-iterations");
  });
});
