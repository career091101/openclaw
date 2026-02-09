import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

import { execFile } from "node:child_process";
import { runTestGate, runTestOnly } from "./test-gate.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTestGate", () => {
  it("passes when all steps succeed", async () => {
    vi.mocked(
      execFile as unknown as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
    ).mockResolvedValue({ stdout: "", stderr: "" });

    const result = await runTestGate("/test/cwd");
    expect(result.passed).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails on build step", async () => {
    vi.mocked(
      execFile as unknown as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
    ).mockRejectedValueOnce(new Error("tsc: type errors found"));

    const result = await runTestGate("/test/cwd");
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe("build");
    expect(result.error).toContain("type errors found");
  });

  it("fails on check step (build passes)", async () => {
    const mock = vi.mocked(
      execFile as unknown as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
    );
    mock.mockResolvedValueOnce({ stdout: "", stderr: "" }); // build passes
    mock.mockRejectedValueOnce(new Error("lint errors")); // check fails

    const result = await runTestGate("/test/cwd");
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe("check");
  });

  it("fails on test step (build + check pass)", async () => {
    const mock = vi.mocked(
      execFile as unknown as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
    );
    mock.mockResolvedValueOnce({ stdout: "", stderr: "" }); // build
    mock.mockResolvedValueOnce({ stdout: "", stderr: "" }); // check
    mock.mockRejectedValueOnce(new Error("test failures")); // test

    const result = await runTestGate("/test/cwd");
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe("test");
  });

  it("truncates long error messages", async () => {
    const longError = "x".repeat(5000);
    vi.mocked(
      execFile as unknown as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
    ).mockRejectedValueOnce(new Error(longError));

    const result = await runTestGate("/test/cwd");
    expect(result.error!.length).toBeLessThanOrEqual(2000);
  });
});

describe("runTestOnly", () => {
  it("passes when test succeeds", async () => {
    vi.mocked(
      execFile as unknown as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
    ).mockResolvedValue({ stdout: "", stderr: "" });

    const result = await runTestOnly("/test/cwd");
    expect(result.passed).toBe(true);
  });

  it("fails when test fails", async () => {
    vi.mocked(
      execFile as unknown as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
    ).mockRejectedValueOnce(new Error("assertion failed"));

    const result = await runTestOnly("/test/cwd");
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe("test");
    expect(result.error).toContain("assertion failed");
  });
});
