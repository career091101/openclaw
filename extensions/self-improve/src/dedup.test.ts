import { describe, it, expect } from "vitest";
import type { TipRecord } from "./types.js";
import { isDuplicate, filterDuplicates } from "./dedup.js";

const makeTip = (overrides: Partial<TipRecord> = {}): TipRecord => ({
  id: "tip-1",
  title: "Improve memory search",
  summary: "Use vector similarity for better memory retrieval",
  sourceUrl: "https://example.com/tip1",
  discoveredAt: Date.now(),
  scores: { relevance: 8, feasibility: 7, impact: 6, total: 21 },
  status: "evaluated",
  ...overrides,
});

describe("dedup", () => {
  describe("isDuplicate", () => {
    it("detects exact URL match", () => {
      const existing = [makeTip()];
      const result = isDuplicate(
        {
          title: "Different title",
          summary: "Different summary",
          sourceUrl: "https://example.com/tip1",
        },
        existing,
      );
      expect(result.duplicate).toBe(true);
      expect(result.similarity).toBe(1);
    });

    it("detects similar title/summary", () => {
      const existing = [makeTip()];
      const result = isDuplicate(
        {
          title: "Improve memory search results",
          summary: "Use vector similarity search for better memory retrieval accuracy",
          sourceUrl: "https://other.com/different",
        },
        existing,
      );
      expect(result.duplicate).toBe(true);
    });

    it("allows different tips", () => {
      const existing = [makeTip()];
      const result = isDuplicate(
        {
          title: "Add caching layer",
          summary: "Implement Redis caching for API responses",
          sourceUrl: "https://other.com/cache",
        },
        existing,
      );
      expect(result.duplicate).toBe(false);
    });

    it("returns false for empty existing list", () => {
      const result = isDuplicate(
        { title: "Any tip", summary: "Any summary", sourceUrl: "https://example.com" },
        [],
      );
      expect(result.duplicate).toBe(false);
    });
  });

  describe("filterDuplicates", () => {
    it("removes duplicates from candidates", () => {
      const existing = [makeTip()];
      const candidates = [
        {
          title: "Improve memory search",
          summary: "Use vector similarity for better memory retrieval",
          sourceUrl: "https://other.com/1",
        },
        {
          title: "Add caching layer",
          summary: "Implement Redis caching for API responses",
          sourceUrl: "https://other.com/2",
        },
      ];
      const result = filterDuplicates(candidates, existing);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Add caching layer");
    });

    it("deduplicates within the batch", () => {
      const candidates = [
        { title: "Add caching", summary: "Implement caching", sourceUrl: "https://a.com" },
        {
          title: "Add caching layer",
          summary: "Implement caching layer",
          sourceUrl: "https://b.com",
        },
      ];
      const result = filterDuplicates(candidates, []);
      expect(result).toHaveLength(1);
    });

    it("returns all when no duplicates", () => {
      const candidates = [
        { title: "Tip A", summary: "Summary A", sourceUrl: "https://a.com" },
        { title: "Tip B", summary: "Summary B completely different", sourceUrl: "https://b.com" },
      ];
      const result = filterDuplicates(candidates, []);
      expect(result).toHaveLength(2);
    });
  });
});
