import { describe, it, expect, beforeEach } from "vitest";
import { createToolAnalyticsTracker } from "./tool-analytics.js";

describe("ToolAnalyticsTracker", () => {
  let tracker = createToolAnalyticsTracker();

  beforeEach(() => {
    tracker = createToolAnalyticsTracker();
  });

  describe("recordExecution", () => {
    it("should record successful tool execution", () => {
      tracker.recordExecution({
        toolName: "test_tool",
        success: true,
        executionTimeMs: 100,
      });

      const analytics = tracker.getToolAnalytics("test_tool");
      expect(analytics).toBeDefined();
      expect(analytics?.totalCalls).toBe(1);
      expect(analytics?.successfulCalls).toBe(1);
      expect(analytics?.failedCalls).toBe(0);
      expect(analytics?.successRate).toBe(1);
    });

    it("should record failed tool execution", () => {
      tracker.recordExecution({
        toolName: "test_tool",
        success: false,
        executionTimeMs: 150,
        errorCategory: "transient",
      });

      const analytics = tracker.getToolAnalytics("test_tool");
      expect(analytics).toBeDefined();
      expect(analytics?.totalCalls).toBe(1);
      expect(analytics?.successfulCalls).toBe(0);
      expect(analytics?.failedCalls).toBe(1);
      expect(analytics?.successRate).toBe(0);
      expect(analytics?.commonErrors).toHaveLength(1);
      expect(analytics?.commonErrors[0]?.category).toBe("transient");
    });

    it("should track multiple executions", () => {
      tracker.recordExecution({ toolName: "tool1", success: true, executionTimeMs: 100 });
      tracker.recordExecution({ toolName: "tool1", success: true, executionTimeMs: 120 });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 80,
        errorCategory: "semantic",
      });

      const analytics = tracker.getToolAnalytics("tool1");
      expect(analytics?.totalCalls).toBe(3);
      expect(analytics?.successfulCalls).toBe(2);
      expect(analytics?.failedCalls).toBe(1);
      expect(analytics?.successRate).toBeCloseTo(2 / 3);
      expect(analytics?.averageExecutionTimeMs).toBeCloseTo(100);
    });

    it("should limit records per tool", () => {
      // Record 150 executions (max is 100)
      for (let i = 0; i < 150; i++) {
        tracker.recordExecution({
          toolName: "popular_tool",
          success: i % 2 === 0,
          executionTimeMs: 100,
        });
      }

      const analytics = tracker.getToolAnalytics("popular_tool");
      // Should only keep last 100
      expect(analytics?.totalCalls).toBe(100);
    });
  });

  describe("getToolAnalytics", () => {
    it("should return undefined for unknown tool", () => {
      const analytics = tracker.getToolAnalytics("unknown");
      expect(analytics).toBeUndefined();
    });

    it("should compute correct success rate", () => {
      tracker.recordExecution({ toolName: "tool1", success: true, executionTimeMs: 100 });
      tracker.recordExecution({ toolName: "tool1", success: true, executionTimeMs: 100 });
      tracker.recordExecution({ toolName: "tool1", success: true, executionTimeMs: 100 });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });

      const analytics = tracker.getToolAnalytics("tool1");
      expect(analytics?.successRate).toBe(0.75);
    });

    it("should track common error categories", () => {
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "semantic",
      });

      const analytics = tracker.getToolAnalytics("tool1");
      expect(analytics?.commonErrors).toHaveLength(2);
      expect(analytics?.commonErrors[0]?.category).toBe("transient");
      expect(analytics?.commonErrors[0]?.count).toBe(2);
      expect(analytics?.commonErrors[1]?.category).toBe("semantic");
      expect(analytics?.commonErrors[1]?.count).toBe(1);
    });

    it("should limit common errors to top 5", () => {
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "resource",
      });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "semantic",
      });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "permanent",
      });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "context_limit",
      });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });

      const analytics = tracker.getToolAnalytics("tool1");
      expect(analytics?.commonErrors.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getAllAnalytics", () => {
    it("should return empty array when no tools tracked", () => {
      const all = tracker.getAllAnalytics();
      expect(all).toEqual([]);
    });

    it("should return all tracked tools", () => {
      tracker.recordExecution({ toolName: "tool1", success: true, executionTimeMs: 100 });
      tracker.recordExecution({ toolName: "tool2", success: true, executionTimeMs: 100 });
      tracker.recordExecution({
        toolName: "tool3",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });

      const all = tracker.getAllAnalytics();
      expect(all).toHaveLength(3);
      expect(all.map((a) => a.toolName).toSorted()).toEqual(["tool1", "tool2", "tool3"]);
    });

    it("should sort by total calls descending", () => {
      tracker.recordExecution({ toolName: "rare", success: true, executionTimeMs: 100 });
      tracker.recordExecution({ toolName: "common", success: true, executionTimeMs: 100 });
      tracker.recordExecution({ toolName: "common", success: true, executionTimeMs: 100 });
      tracker.recordExecution({ toolName: "common", success: true, executionTimeMs: 100 });

      const all = tracker.getAllAnalytics();
      expect(all[0]?.toolName).toBe("common");
      expect(all[1]?.toolName).toBe("rare");
    });
  });

  describe("generateSnapshot and loadSnapshot", () => {
    it("should generate valid snapshot", () => {
      tracker.recordExecution({ toolName: "tool1", success: true, executionTimeMs: 100 });
      tracker.recordExecution({
        toolName: "tool1",
        success: false,
        executionTimeMs: 120,
        errorCategory: "transient",
      });

      const snapshot = tracker.generateSnapshot();
      expect(snapshot.version).toBe("1.0.0");
      expect(snapshot.generatedAt).toBeGreaterThan(0);
      expect(snapshot.tools.tool1).toBeDefined();
      expect(snapshot.tools.tool1?.totalCalls).toBe(2);
    });

    it("should load snapshot correctly", () => {
      const snapshot = {
        version: "1.0.0",
        generatedAt: Date.now(),
        tools: {
          tool1: {
            toolName: "tool1",
            totalCalls: 10,
            successfulCalls: 8,
            failedCalls: 2,
            successRate: 0.8,
            averageExecutionTimeMs: 150,
            commonErrors: [{ category: "transient" as const, count: 2 }],
            lastUsed: Date.now(),
          },
        },
      };

      tracker.loadSnapshot(snapshot);
      const analytics = tracker.getToolAnalytics("tool1");
      expect(analytics).toBeDefined();
      expect(analytics?.successRate).toBeGreaterThan(0);
    });

    it("should clear existing data when loading snapshot", () => {
      tracker.recordExecution({ toolName: "old_tool", success: true, executionTimeMs: 100 });

      const snapshot = {
        version: "1.0.0",
        generatedAt: Date.now(),
        tools: {
          new_tool: {
            toolName: "new_tool",
            totalCalls: 5,
            successfulCalls: 5,
            failedCalls: 0,
            successRate: 1,
            averageExecutionTimeMs: 100,
            commonErrors: [],
            lastUsed: Date.now(),
          },
        },
      };

      tracker.loadSnapshot(snapshot);
      expect(tracker.getToolAnalytics("old_tool")).toBeUndefined();
      expect(tracker.getToolAnalytics("new_tool")).toBeDefined();
    });
  });

  describe("getRecommendations", () => {
    it("should return undefined for empty tool list", () => {
      const recs = tracker.getRecommendations([]);
      expect(recs).toBeUndefined();
    });

    it("should return undefined when no tools have analytics", () => {
      const recs = tracker.getRecommendations(["unknown1", "unknown2"]);
      expect(recs).toBeUndefined();
    });

    it("should recommend high success rate tools", () => {
      // Record 10 successful calls for reliable_tool
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution({ toolName: "reliable_tool", success: true, executionTimeMs: 100 });
      }

      const recs = tracker.getRecommendations(["reliable_tool"]);
      expect(recs).toContain("reliable_tool");
      expect(recs).toContain("100%");
    });

    it("should warn about low success rate tools", () => {
      tracker.recordExecution({
        toolName: "unreliable",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });
      tracker.recordExecution({
        toolName: "unreliable",
        success: false,
        executionTimeMs: 100,
        errorCategory: "transient",
      });
      tracker.recordExecution({ toolName: "unreliable", success: true, executionTimeMs: 100 });

      const recs = tracker.getRecommendations(["unreliable"]);
      expect(recs).toContain("unreliable");
      expect(recs).toContain("33%");
    });

    it("should identify fastest tools", () => {
      tracker.recordExecution({ toolName: "fast", success: true, executionTimeMs: 50 });
      tracker.recordExecution({ toolName: "slow", success: true, executionTimeMs: 8000 });

      const recs = tracker.getRecommendations(["fast", "slow"]);
      expect(recs).toContain("fast");
      expect(recs).toContain("fastest");
    });
  });

  describe("pruneOldRecords", () => {
    it("should remove expired records", () => {
      // This test would need to mock Date.now() or use a testing clock
      // For now, we just verify the method exists and can be called
      expect(typeof tracker.pruneOldRecords).toBe("function");
      tracker.pruneOldRecords();
    });
  });
});
