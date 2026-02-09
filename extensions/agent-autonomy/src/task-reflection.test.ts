import { describe, it, expect } from "vitest";
import { reflectOnTaskResult } from "./task-reflection.js";

describe("task-reflection", () => {
  describe("reflectOnTaskResult", () => {
    it("accepts a good, complete result", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Create a new user authentication module",
        result:
          "Created the authentication module with login, logout, and password reset functionality. All tests passing.",
        success: true,
      });

      expect(result.valid).toBe(true);
      expect(result.needsRevision).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it("detects very short results", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Implement the feature",
        result: "Done",
        success: true,
      });

      expect(result.valid).toBe(false);
      expect(result.needsRevision).toBe(true);
      expect(result.issues.some((i) => i.includes("very short"))).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("detects placeholder text", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Write the documentation",
        result: "Documentation created with TODO sections for API examples",
        success: true,
      });

      expect(result.valid).toBe(false);
      expect(result.needsRevision).toBe(true);
      expect(result.issues.some((i) => i.includes("placeholder"))).toBe(true);
    });

    it("detects error indicators in successful results", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Deploy the application",
        result: "Failed to deploy due to network issues",
        success: true,
      });

      expect(result.issues.some((i) => i.includes("error indicators"))).toBe(true);
      expect(result.confidence).toBeLessThan(1);
    });

    it("detects missing error message on failure", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Run the tests",
        result: "The tests did not complete successfully",
        success: false,
      });

      expect(result.issues.some((i) => i.includes("no error message"))).toBe(true);
      expect(result.suggestions.some((s) => s.includes("error message"))).toBe(true);
    });

    it("detects results that don't address task requirements", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Create and test the new API endpoint",
        result: "Updated some documentation files",
        success: true,
      });

      expect(result.valid).toBe(false);
      expect(result.needsRevision).toBe(true);
      expect(result.issues.some((i) => i.includes("doesn't appear to address"))).toBe(true);
    });

    it("warns about very long results", () => {
      const longText = "A".repeat(2100);
      const result = reflectOnTaskResult({
        taskDescription: "Analyze the codebase",
        result: longText,
        success: true,
      });

      expect(result.issues.some((i) => i.includes("very long"))).toBe(true);
      expect(result.suggestions.some((s) => s.includes("summarizing"))).toBe(true);
    });

    it("detects contradictory status (success with error)", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Fix the bug",
        result: "Applied the fix",
        success: true,
        error: "Something went wrong",
      });

      expect(result.valid).toBe(false);
      expect(result.needsRevision).toBe(true);
      expect(result.issues.some((i) => i.includes("successful but has an error"))).toBe(true);
    });

    it("handles proper failure cases", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Connect to the database",
        result: "Unable to establish connection",
        success: false,
        error: "Connection timeout after 30 seconds",
      });

      expect(result.valid).toBe(true);
      expect(result.needsRevision).toBe(false);
    });

    it("extracts action words correctly", () => {
      const result = reflectOnTaskResult({
        taskDescription: "Test the payment integration thoroughly",
        result: "Built the application successfully and deployed to staging",
        success: true,
      });

      // Should detect that the result doesn't address the task (testing payment)
      expect(result.needsRevision).toBe(true);
      expect(result.issues.some((i) => i.includes("doesn't appear to address"))).toBe(true);
    });
  });
});
