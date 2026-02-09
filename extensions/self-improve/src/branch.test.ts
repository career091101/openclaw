import { describe, it, expect } from "vitest";
import { buildBranchName } from "./branch.js";

describe("branch", () => {
  describe("buildBranchName", () => {
    it("creates a valid branch name from a slug", () => {
      const name = buildBranchName("improve-memory-search");
      expect(name).toMatch(/^self-improve\/improve-memory-search-\d{8}$/);
    });

    it("sanitizes special characters", () => {
      const name = buildBranchName("Add Better Error Handling!!!");
      expect(name).toMatch(/^self-improve\/add-better-error-handling-\d{8}$/);
    });

    it("truncates long slugs", () => {
      const longSlug = "a".repeat(100);
      const name = buildBranchName(longSlug);
      // self-improve/ + 40 chars + - + 8 date chars
      expect(name.length).toBeLessThanOrEqual(63);
    });

    it("handles empty string", () => {
      const name = buildBranchName("");
      expect(name).toMatch(/^self-improve\/-\d{8}$/);
    });
  });
});
