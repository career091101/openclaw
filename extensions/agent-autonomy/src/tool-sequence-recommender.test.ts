import { describe, it, expect, beforeEach } from "vitest";
import { createToolSequenceRecommender } from "./tool-sequence-recommender.js";

describe("ToolSequenceRecommender", () => {
  let recommender = createToolSequenceRecommender();

  beforeEach(() => {
    recommender = createToolSequenceRecommender();
  });

  describe("recordToolUse", () => {
    it("should track execution history", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);
      recommender.recordToolUse("exec", true);

      expect(recommender.getExecutionHistory()).toEqual(["read", "edit", "exec"]);
    });

    it("should record transitions between consecutive tools", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      const stats = recommender.getTransitionStats("read");
      expect(stats).toHaveLength(1);
      expect(stats[0]?.to).toBe("edit");
      expect(stats[0]?.count).toBe(1);
      expect(stats[0]?.successRate).toBe(1);
    });

    it("should not record transition for the first tool", () => {
      recommender.recordToolUse("read", true);

      // No previous tool → no transition recorded
      const stats = recommender.getTransitionStats("read");
      expect(stats).toHaveLength(0);
    });

    it("should limit execution history length", () => {
      for (let i = 0; i < 25; i++) {
        recommender.recordToolUse(`tool_${i}`, true);
      }

      const history = recommender.getExecutionHistory();
      expect(history.length).toBeLessThanOrEqual(20);
      // Should keep the most recent tools
      expect(history[history.length - 1]).toBe("tool_24");
    });

    it("should track success and failure transitions separately", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true); // read → edit (success)

      recommender.resetSequence();
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", false); // read → edit (failure)

      const stats = recommender.getTransitionStats("read");
      expect(stats).toHaveLength(1);
      expect(stats[0]?.to).toBe("edit");
      expect(stats[0]?.count).toBe(2);
      expect(stats[0]?.successCount).toBe(1);
      expect(stats[0]?.successRate).toBe(0.5);
    });
  });

  describe("resetSequence", () => {
    it("should clear execution history", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      recommender.resetSequence();
      expect(recommender.getExecutionHistory()).toEqual([]);
    });

    it("should not clear learned transitions", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      recommender.resetSequence();

      const stats = recommender.getTransitionStats("read");
      expect(stats).toHaveLength(1);
      expect(stats[0]?.to).toBe("edit");
    });
  });

  describe("getNextRecommendations", () => {
    it("should return empty array for tool with no transitions", () => {
      const recs = recommender.getNextRecommendations("unknown_tool");
      expect(recs).toEqual([]);
    });

    it("should recommend tools based on transition history", () => {
      // Build up: read is commonly followed by edit
      for (let i = 0; i < 5; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.resetSequence();
      }

      const recs = recommender.getNextRecommendations("read");
      expect(recs).toHaveLength(1);
      expect(recs[0]?.toolName).toBe("edit");
      expect(recs[0]?.transitionCount).toBe(5);
    });

    it("should rank by score (frequency + success + recency)", () => {
      // edit follows read 10 times (all success)
      for (let i = 0; i < 10; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.resetSequence();
      }

      // exec follows read 3 times (all success)
      for (let i = 0; i < 3; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("exec", true);
        recommender.resetSequence();
      }

      const recs = recommender.getNextRecommendations("read");
      expect(recs.length).toBeGreaterThanOrEqual(2);
      // edit should rank higher due to higher frequency
      expect(recs[0]?.toolName).toBe("edit");
      expect(recs[1]?.toolName).toBe("exec");
    });

    it("should filter by available tools", () => {
      for (let i = 0; i < 5; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.resetSequence();
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("exec", true);
        recommender.resetSequence();
      }

      const recs = recommender.getNextRecommendations("read", ["exec", "write"]);
      expect(recs).toHaveLength(1);
      expect(recs[0]?.toolName).toBe("exec");
    });

    it("should respect the limit parameter", () => {
      // Create many different transitions from "read"
      for (let i = 0; i < 10; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse(`tool_${i}`, true);
        recommender.resetSequence();
      }

      const recs = recommender.getNextRecommendations("read", undefined, 3);
      expect(recs).toHaveLength(3);
    });

    it("should factor success rate into ranking", () => {
      // toolA follows read 5 times, all success
      for (let i = 0; i < 5; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("toolA", true);
        recommender.resetSequence();
      }

      // toolB follows read 5 times, all failures
      for (let i = 0; i < 5; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("toolB", false);
        recommender.resetSequence();
      }

      const recs = recommender.getNextRecommendations("read");
      expect(recs[0]?.toolName).toBe("toolA");
      expect(recs[0]?.successRate).toBe(1);
      expect(recs[1]?.toolName).toBe("toolB");
      expect(recs[1]?.successRate).toBe(0);
    });
  });

  describe("getContextualRecommendations", () => {
    it("should return empty when no execution history", () => {
      const recs = recommender.getContextualRecommendations();
      expect(recs).toEqual([]);
    });

    it("should aggregate recommendations from recent history", () => {
      // Build patterns: read → edit, edit → exec
      for (let i = 0; i < 5; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.recordToolUse("exec", true);
        recommender.resetSequence();
      }

      // Now simulate: user is in a session, just used read then edit
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      // exec should be recommended (edit → exec is a common pattern)
      const recs = recommender.getContextualRecommendations();
      const execRec = recs.find((r) => r.toolName === "exec");
      expect(execRec).toBeDefined();
    });

    it("should exclude tools already in recent history to avoid loops", () => {
      // Build pattern: read → edit → read (loop)
      for (let i = 0; i < 5; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.recordToolUse("read", true);
        recommender.resetSequence();
      }

      // Now user just used read → edit
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      const recs = recommender.getContextualRecommendations();
      // "read" should be excluded since it's in the history
      const readRec = recs.find((r) => r.toolName === "read");
      expect(readRec).toBeUndefined();
    });

    it("should filter by available tools", () => {
      for (let i = 0; i < 5; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.recordToolUse("exec", true);
        recommender.resetSequence();
      }

      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      const recs = recommender.getContextualRecommendations(["write", "exec"]);
      for (const rec of recs) {
        expect(["write", "exec"]).toContain(rec.toolName);
      }
    });
  });

  describe("formatRecommendations", () => {
    it("should return empty string for no recommendations", () => {
      const formatted = recommender.formatRecommendations([]);
      expect(formatted).toBe("");
    });

    it("should format recommendations with scores and stats", () => {
      const recs = [
        { toolName: "edit", score: 1.5, transitionCount: 10, successRate: 0.9 },
        { toolName: "exec", score: 0.8, transitionCount: 3, successRate: 1.0 },
      ];

      const formatted = recommender.formatRecommendations(recs);
      expect(formatted).toContain("## Suggested Next Tools");
      expect(formatted).toContain("edit");
      expect(formatted).toContain("90%");
      expect(formatted).toContain("exec");
      expect(formatted).toContain("100%");
    });
  });

  describe("generateSnapshot and loadSnapshot", () => {
    it("should generate valid snapshot", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);
      recommender.recordToolUse("exec", true);

      const snapshot = recommender.generateSnapshot();
      expect(snapshot.version).toBe("1.0.0");
      expect(snapshot.generatedAt).toBeGreaterThan(0);
      expect(snapshot.transitions.read).toBeDefined();
      expect(snapshot.transitions.edit).toBeDefined();
    });

    it("should round-trip through snapshot correctly", () => {
      // Build up patterns
      for (let i = 0; i < 10; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.resetSequence();
      }

      const snapshot = recommender.generateSnapshot();

      // Create new recommender and load snapshot
      const newRecommender = createToolSequenceRecommender();
      newRecommender.loadSnapshot(snapshot);

      const originalStats = recommender.getTransitionStats("read");
      const loadedStats = newRecommender.getTransitionStats("read");

      expect(loadedStats).toHaveLength(originalStats.length);
      expect(loadedStats[0]?.to).toBe(originalStats[0]?.to);
      expect(loadedStats[0]?.count).toBe(originalStats[0]?.count);
      expect(loadedStats[0]?.successRate).toBe(originalStats[0]?.successRate);
    });

    it("should clear existing data when loading snapshot", () => {
      recommender.recordToolUse("old_tool", true);
      recommender.recordToolUse("old_target", true);

      const snapshot = {
        version: "1.0.0",
        generatedAt: Date.now(),
        transitions: {
          new_tool: [
            {
              from: "new_tool",
              to: "new_target",
              count: 5,
              successCount: 5,
              successRate: 1,
              lastSeen: Date.now(),
            },
          ],
        },
      };

      recommender.loadSnapshot(snapshot);
      expect(recommender.getTransitionStats("old_tool")).toHaveLength(0);
      expect(recommender.getTransitionStats("new_tool")).toHaveLength(1);
      expect(recommender.getExecutionHistory()).toEqual([]);
    });
  });

  describe("pruneOldTransitions", () => {
    it("should be callable without error", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      expect(() => recommender.pruneOldTransitions()).not.toThrow();
    });

    it("should not remove recent transitions", () => {
      recommender.recordToolUse("read", true);
      recommender.recordToolUse("edit", true);

      recommender.pruneOldTransitions();

      const stats = recommender.getTransitionStats("read");
      expect(stats).toHaveLength(1);
    });
  });

  describe("integration: multi-step workflow patterns", () => {
    it("should learn a common 3-step workflow pattern", () => {
      // Simulate a common pattern: read → edit → exec (build/test)
      for (let i = 0; i < 20; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.recordToolUse("exec", true);
        recommender.resetSequence();
      }

      // After "read", "edit" should be strongly recommended
      const afterRead = recommender.getNextRecommendations("read");
      expect(afterRead[0]?.toolName).toBe("edit");

      // After "edit", "exec" should be strongly recommended
      const afterEdit = recommender.getNextRecommendations("edit");
      expect(afterEdit[0]?.toolName).toBe("exec");
    });

    it("should handle multiple branching patterns", () => {
      // Pattern 1: read → edit (70% of time)
      for (let i = 0; i < 7; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.resetSequence();
      }

      // Pattern 2: read → exec (30% of time)
      for (let i = 0; i < 3; i++) {
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("exec", true);
        recommender.resetSequence();
      }

      const recs = recommender.getNextRecommendations("read");
      expect(recs).toHaveLength(2);
      // edit should be ranked higher
      expect(recs[0]?.toolName).toBe("edit");
      expect(recs[1]?.toolName).toBe("exec");
    });

    it("should provide useful contextual recommendations during a session", () => {
      // Train the model on a common workflow
      for (let i = 0; i < 15; i++) {
        recommender.recordToolUse("memory_search", true);
        recommender.recordToolUse("read", true);
        recommender.recordToolUse("edit", true);
        recommender.recordToolUse("exec", true);
        recommender.resetSequence();
      }

      // Now simulate: user just started a new task
      recommender.recordToolUse("memory_search", true);
      recommender.recordToolUse("read", true);

      // The system should recommend "edit" as next step
      const recs = recommender.getContextualRecommendations();
      const editRec = recs.find((r) => r.toolName === "edit");
      expect(editRec).toBeDefined();
      expect(editRec!.score).toBeGreaterThan(0);
    });
  });
});
