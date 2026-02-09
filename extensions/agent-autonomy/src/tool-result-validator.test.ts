import { describe, expect, it } from "vitest";
import { createToolResultValidator } from "./tool-result-validator.js";

describe("createToolResultValidator", () => {
  const validator = createToolResultValidator();

  describe("exec tool", () => {
    it("validates successful exec (exit code 0)", () => {
      const result = validator.validate({
        toolName: "exec",
        exitCode: 0,
        result: { output: "success" },
      });
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("detects non-zero exit code", () => {
      const result = validator.validate({
        toolName: "exec",
        exitCode: 1,
        result: { output: "", error: "command failed" },
      });
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("detects signal kill", () => {
      const result = validator.validate({
        toolName: "exec",
        exitCode: 137,
      });
      expect(result.valid).toBe(false);
      expect(result.suggestedAction).toBe("retry_same");
    });
  });

  describe("error field detection", () => {
    it("detects error field in results", () => {
      const result = validator.validate({
        toolName: "memory_search",
        result: { results: [], error: "ECONNREFUSED" },
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("empty search results", () => {
    it("notes empty search results", () => {
      const result = validator.validate({
        toolName: "web_search",
        result: { results: [] },
      });
      expect(result.issues).toContain("search returned empty results");
      expect(result.suggestedAction).toBe("modify_params");
    });
  });

  describe("HTTP errors", () => {
    it("detects 403 forbidden", () => {
      const result = validator.validate({
        toolName: "web_fetch",
        result: { statusCode: 403, body: "" },
      });
      expect(result.valid).toBe(false);
      expect(result.suggestedAction).toBe("alternative_tool");
    });

    it("detects 404 not found", () => {
      const result = validator.validate({
        toolName: "web_fetch",
        result: { statusCode: 404, body: "" },
      });
      expect(result.valid).toBe(false);
      expect(result.suggestedAction).toBe("modify_params");
    });

    it("detects 500 server error", () => {
      const result = validator.validate({
        toolName: "web_fetch",
        result: { statusCode: 500, body: "" },
      });
      expect(result.valid).toBe(false);
      expect(result.suggestedAction).toBe("retry_same");
    });
  });

  describe("memory disabled", () => {
    it("detects disabled memory tool", () => {
      const result = validator.validate({
        toolName: "memory_search",
        result: { disabled: true, error: "no provider", results: [] },
      });
      expect(result.valid).toBe(false);
      expect(result.suggestedAction).toBe("escalate");
    });
  });

  describe("explicit tool error", () => {
    it("handles explicit error string", () => {
      const result = validator.validate({
        toolName: "read",
        error: "ENOENT: no such file",
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("default case", () => {
    it("returns valid for normal results", () => {
      const result = validator.validate({
        toolName: "read",
        result: { text: "file content", path: "test.ts" },
      });
      expect(result.valid).toBe(true);
    });
  });
});
