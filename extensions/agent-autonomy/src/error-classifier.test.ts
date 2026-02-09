import { describe, expect, it } from "vitest";
import { classifyError, classifyExitCode } from "./error-classifier.js";

describe("classifyError", () => {
  it("classifies network errors as transient", () => {
    const result = classifyError("connect ECONNREFUSED 127.0.0.1:3000");
    expect(result.category).toBe("transient");
    expect(result.isRetryable).toBe(true);
    expect(result.suggestedStrategy).toBe("retry_same");
  });

  it("classifies rate limits as transient", () => {
    const result = classifyError("Error 429: Too Many Requests");
    expect(result.category).toBe("transient");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies timeouts as transient", () => {
    const result = classifyError("Request timed out after 30s");
    expect(result.category).toBe("transient");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies file not found as resource error", () => {
    const result = classifyError("ENOENT: no such file or directory, open '/tmp/missing.txt'");
    expect(result.category).toBe("resource");
    expect(result.suggestedStrategy).toBe("modify_params");
  });

  it("classifies permission denied as resource error", () => {
    const result = classifyError("EACCES: permission denied");
    expect(result.category).toBe("resource");
    expect(result.suggestedStrategy).toBe("alternative_tool");
  });

  it("classifies context limit errors", () => {
    const result = classifyError("context length exceeded: 128000 tokens");
    expect(result.category).toBe("context_limit");
    expect(result.suggestedStrategy).toBe("modify_params");
  });

  it("classifies authentication errors as permanent", () => {
    const result = classifyError("401 Unauthorized: Invalid API key");
    expect(result.category).toBe("permanent");
    expect(result.suggestedStrategy).toBe("escalate");
  });

  it("classifies invalid params as semantic", () => {
    const result = classifyError("Invalid parameter: 'path' must be a string");
    expect(result.category).toBe("semantic");
    expect(result.suggestedStrategy).toBe("modify_params");
  });

  it("returns fallback for unknown errors", () => {
    const result = classifyError("Something completely unexpected happened");
    expect(result.category).toBe("semantic");
    expect(result.suggestedStrategy).toBe("escalate");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("handles empty error message", () => {
    const result = classifyError("");
    expect(result.confidence).toBeLessThan(0.5);
  });
});

describe("classifyExitCode", () => {
  it("classifies exit code 0 as success", () => {
    const result = classifyExitCode(0);
    expect(result.confidence).toBe(1);
    expect(result.isRetryable).toBe(false);
  });

  it("classifies signal kills as transient", () => {
    const result = classifyExitCode(137); // SIGKILL
    expect(result.category).toBe("transient");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies command not found", () => {
    const result = classifyExitCode(127);
    expect(result.category).toBe("resource");
    expect(result.suggestedStrategy).toBe("alternative_tool");
  });

  it("classifies permission denied via exit code", () => {
    const result = classifyExitCode(126);
    expect(result.category).toBe("resource");
  });
});
