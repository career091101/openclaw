import { describe, it, expect, beforeEach } from "vitest";
import {
  DualMemoryManager,
  createDualMemoryManager,
  createMemoryItem,
} from "./dual-memory-architecture.js";

describe("DualMemoryManager", () => {
  let manager: DualMemoryManager;

  beforeEach(() => {
    manager = new DualMemoryManager({
      shortTermCapacity: 5,
      shortTermTokenBudget: 1000,
      autoPromote: false, // Disable auto-promote for predictable testing
      promotionThreshold: 0.7,
    });
  });

  describe("addToShortTerm", () => {
    it("should add an item to short-term memory", () => {
      const id = manager.addToShortTerm({
        content: "Test task",
        type: "task",
        priority: 0.8,
      });

      expect(id).toMatch(/^stm_/);
      const context = manager.getShortTermContext();
      expect(context).toHaveLength(1);
      expect(context[0].content).toBe("Test task");
      expect(context[0].type).toBe("task");
      expect(context[0].priority).toBe(0.8);
    });

    it("should generate unique IDs for each item", () => {
      const id1 = manager.addToShortTerm({
        content: "Item 1",
        type: "task",
        priority: 0.5,
      });
      const id2 = manager.addToShortTerm({
        content: "Item 2",
        type: "observation",
        priority: 0.6,
      });

      expect(id1).not.toBe(id2);
    });

    it("should evict lowest-priority items when capacity is exceeded", () => {
      // Add 5 items (at capacity)
      manager.addToShortTerm({ content: "Item 1", type: "task", priority: 0.9 });
      manager.addToShortTerm({ content: "Item 2", type: "task", priority: 0.8 });
      manager.addToShortTerm({ content: "Item 3", type: "task", priority: 0.7 });
      manager.addToShortTerm({ content: "Item 4", type: "task", priority: 0.6 });
      manager.addToShortTerm({ content: "Item 5", type: "task", priority: 0.5 });

      // Add one more (exceeds capacity)
      manager.addToShortTerm({ content: "Item 6", type: "task", priority: 0.95 });

      const context = manager.getShortTermContext();
      expect(context).toHaveLength(5);

      // Lowest priority item should be evicted
      expect(context.find((item) => item.content === "Item 5")).toBeUndefined();
      expect(context.find((item) => item.content === "Item 6")).toBeDefined();
    });
  });

  describe("getShortTermContext", () => {
    it("should return items sorted by priority (descending)", () => {
      manager.addToShortTerm({ content: "Low", type: "task", priority: 0.3 });
      manager.addToShortTerm({ content: "High", type: "task", priority: 0.9 });
      manager.addToShortTerm({ content: "Medium", type: "task", priority: 0.6 });

      const context = manager.getShortTermContext();

      expect(context[0].content).toBe("High");
      expect(context[1].content).toBe("Medium");
      expect(context[2].content).toBe("Low");
    });

    it("should return empty array when no items", () => {
      const context = manager.getShortTermContext();
      expect(context).toEqual([]);
    });
  });

  describe("formatShortTermForContext", () => {
    it("should format memory items by type", () => {
      manager.addToShortTerm({ content: "Task 1", type: "task", priority: 0.9 });
      manager.addToShortTerm({
        content: "Observation 1",
        type: "observation",
        priority: 0.5,
      });
      manager.addToShortTerm({ content: "Decision 1", type: "decision", priority: 0.7 });
      manager.addToShortTerm({
        content: "Reflection 1",
        type: "reflection",
        priority: 0.6,
      });

      const formatted = manager.formatShortTermForContext();

      expect(formatted).toContain("Current Tasks:");
      expect(formatted).toContain("- Task 1");
      expect(formatted).toContain("Recent Observations:");
      expect(formatted).toContain("- Observation 1");
      expect(formatted).toContain("Recent Decisions:");
      expect(formatted).toContain("- Decision 1");
      expect(formatted).toContain("Reflections:");
      expect(formatted).toContain("- Reflection 1");
    });

    it("should return empty string when no items", () => {
      const formatted = manager.formatShortTermForContext();
      expect(formatted).toBe("");
    });

    it("should handle single type of items", () => {
      manager.addToShortTerm({ content: "Task 1", type: "task", priority: 0.9 });
      manager.addToShortTerm({ content: "Task 2", type: "task", priority: 0.8 });

      const formatted = manager.formatShortTermForContext();

      expect(formatted).toContain("Current Tasks:");
      expect(formatted).toContain("- Task 1");
      expect(formatted).toContain("- Task 2");
      expect(formatted).not.toContain("Recent Observations:");
    });
  });

  describe("clearShortTerm", () => {
    it("should remove all items from short-term memory", () => {
      manager.addToShortTerm({ content: "Item 1", type: "task", priority: 0.8 });
      manager.addToShortTerm({ content: "Item 2", type: "observation", priority: 0.5 });

      manager.clearShortTerm();

      const context = manager.getShortTermContext();
      expect(context).toHaveLength(0);
    });
  });

  describe("updatePriority", () => {
    it("should update priority of existing item", () => {
      const id = manager.addToShortTerm({
        content: "Test",
        type: "task",
        priority: 0.5,
      });

      const updated = manager.updatePriority(id, 0.9);

      expect(updated).toBe(true);
      const context = manager.getShortTermContext();
      expect(context[0].priority).toBe(0.9);
    });

    it("should return false for non-existent item", () => {
      const updated = manager.updatePriority("non_existent_id", 0.9);
      expect(updated).toBe(false);
    });
  });

  describe("removeFromShortTerm", () => {
    it("should remove specified item", () => {
      const id = manager.addToShortTerm({ content: "Test", type: "task", priority: 0.8 });

      const removed = manager.removeFromShortTerm(id);

      expect(removed).toBe(true);
      const context = manager.getShortTermContext();
      expect(context).toHaveLength(0);
    });

    it("should return false for non-existent item", () => {
      const removed = manager.removeFromShortTerm("non_existent_id");
      expect(removed).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      manager.addToShortTerm({ content: "Item 1", type: "task", priority: 0.8 });
      manager.addToShortTerm({ content: "Item 2", type: "observation", priority: 0.5 });

      const stats = manager.getStats();

      expect(stats.shortTermCount).toBe(2);
      expect(stats.shortTermCapacity).toBe(5);
      expect(stats.utilizationPct).toBe(40);
    });

    it("should show 100% utilization at capacity", () => {
      for (let i = 0; i < 5; i++) {
        manager.addToShortTerm({
          content: `Item ${i}`,
          type: "task",
          priority: 0.5,
        });
      }

      const stats = manager.getStats();

      expect(stats.utilizationPct).toBe(100);
    });
  });

  describe("auto-promotion", () => {
    it("should auto-promote high-priority items when enabled", () => {
      const managerWithPromotion = new DualMemoryManager({
        shortTermCapacity: 5,
        autoPromote: true,
        promotionThreshold: 0.7,
      });

      // Add high-priority item (>= 0.7)
      managerWithPromotion.addToShortTerm({
        content: "High priority task",
        type: "task",
        priority: 0.9,
      });

      // Item should still be in short-term memory
      const context = managerWithPromotion.getShortTermContext();
      expect(context).toHaveLength(1);

      // In a real implementation, we would verify the item
      // was also stored in long-term memory via the adapter
    });
  });
});

describe("createMemoryItem", () => {
  it("should create task with high priority", () => {
    const item = createMemoryItem("Complete deployment", "task");

    expect(item.content).toBe("Complete deployment");
    expect(item.type).toBe("task");
    expect(item.priority).toBe(0.9);
  });

  it("should create observation with medium priority", () => {
    const item = createMemoryItem("User logged in", "observation");

    expect(item.priority).toBe(0.5);
  });

  it("should increase priority for urgent items", () => {
    const item = createMemoryItem("System error detected", "observation", {
      isUrgent: true,
    });

    expect(item.priority).toBe(0.7); // 0.5 + 0.2
  });

  it("should increase priority for task-relevant items", () => {
    const item = createMemoryItem("Found solution", "observation", {
      isRelevantToCurrentTask: true,
    });

    expect(item.priority).toBe(0.6); // 0.5 + 0.1
  });

  it("should cap priority at 1.0", () => {
    const item = createMemoryItem("Critical task", "task", {
      isUrgent: true,
      isRelevantToCurrentTask: true,
    });

    expect(item.priority).toBeLessThanOrEqual(1.0);
  });
});

describe("createDualMemoryManager", () => {
  it("should create manager with default config", () => {
    const manager = createDualMemoryManager();
    const stats = manager.getStats();

    expect(stats.shortTermCapacity).toBe(20);
  });

  it("should create manager with custom config", () => {
    const manager = createDualMemoryManager({
      shortTermCapacity: 10,
    });
    const stats = manager.getStats();

    expect(stats.shortTermCapacity).toBe(10);
  });
});
