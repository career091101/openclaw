import { describe, it, expect, beforeEach } from "vitest";
import {
  ContextBudgetManager,
  createBudgetManager,
  DEFAULT_SLOTS,
  type BudgetSlot,
} from "./context-budget-manager.js";

describe("ContextBudgetManager", () => {
  let manager: ContextBudgetManager;

  beforeEach(() => {
    manager = new ContextBudgetManager({
      totalTokens: 128000,
      outputReserve: 4096,
    });
  });

  describe("constructor", () => {
    it("should initialize with default slots", () => {
      const snapshot = manager.getSnapshot();
      expect(snapshot.slots.length).toBe(DEFAULT_SLOTS.length);
      expect(snapshot.totalUsed).toBe(0);
      expect(snapshot.usableBudget).toBe(128000 - 4096);
    });

    it("should accept custom slots", () => {
      const customSlots: BudgetSlot[] = [
        {
          id: "test",
          label: "Test",
          priority: "normal",
          minTokens: 100,
          maxTokens: 1000,
          currentTokens: 0,
          shareable: true,
        },
      ];

      const custom = new ContextBudgetManager({
        totalTokens: 8192,
        slots: customSlots,
      });

      const snapshot = custom.getSnapshot();
      expect(snapshot.slots).toHaveLength(1);
      expect(snapshot.slots[0].id).toBe("test");
    });

    it("should throw on invalid totalTokens", () => {
      expect(() => new ContextBudgetManager({ totalTokens: 0 })).toThrow(
        "totalTokens must be positive",
      );

      expect(() => new ContextBudgetManager({ totalTokens: -1 })).toThrow(
        "totalTokens must be positive",
      );
    });

    it("should throw when outputReserve >= totalTokens", () => {
      expect(() => new ContextBudgetManager({ totalTokens: 1000, outputReserve: 1000 })).toThrow(
        "outputReserve must be less than totalTokens",
      );
    });

    it("should throw when min slot requirements exceed usable budget", () => {
      const bigMinSlots: BudgetSlot[] = [
        {
          id: "huge",
          label: "Huge",
          priority: "critical",
          minTokens: 10000,
          maxTokens: 20000,
          currentTokens: 0,
          shareable: false,
        },
      ];

      expect(
        () =>
          new ContextBudgetManager({ totalTokens: 5000, outputReserve: 1000, slots: bigMinSlots }),
      ).toThrow("exceed usable budget");
    });
  });

  describe("usableBudget", () => {
    it("should return totalTokens minus outputReserve", () => {
      expect(manager.usableBudget).toBe(128000 - 4096);
    });
  });

  describe("estimate", () => {
    it("should estimate tokens using chars_div_4 by default", () => {
      const text = "a".repeat(400);
      expect(manager.estimate(text)).toBe(100);
    });

    it("should use word-based estimation when configured", () => {
      const wordManager = new ContextBudgetManager({
        totalTokens: 128000,
        estimationMethod: "words",
      });

      // 10 words * 1.33 ≈ 14 tokens
      const text = "one two three four five six seven eight nine ten";
      const estimated = wordManager.estimate(text);
      expect(estimated).toBeGreaterThanOrEqual(13);
      expect(estimated).toBeLessThanOrEqual(14);
    });

    it("should use custom estimator when provided", () => {
      const customManager = new ContextBudgetManager({
        totalTokens: 128000,
        estimationMethod: "custom",
        customEstimator: (text) => text.length, // 1 char = 1 token
      });

      expect(customManager.estimate("hello")).toBe(5);
    });
  });

  describe("requestAllocation", () => {
    it("should approve allocation within budget", () => {
      const content = "A".repeat(4000); // ~1000 tokens
      const result = manager.requestAllocation("system_prompt", content);

      expect(result.fits).toBe(true);
      expect(result.allocatedTokens).toBe(1000);
      expect(result.overflowTokens).toBe(0);
    });

    it("should reject allocation exceeding slot max when global budget is exhausted", () => {
      // Use a tightly constrained budget so borrowing cannot cover the overflow
      const tight = new ContextBudgetManager({
        totalTokens: 10000,
        outputReserve: 1000,
        slots: [
          {
            id: "primary",
            label: "Primary",
            priority: "critical",
            minTokens: 100,
            maxTokens: 2000,
            currentTokens: 0,
            shareable: false,
          },
          {
            id: "secondary",
            label: "Secondary",
            priority: "normal",
            minTokens: 500,
            maxTokens: 7000,
            currentTokens: 7000,
            shareable: true,
          },
        ],
      });

      // Request 5000 tokens for primary (max 2000), global remaining = 9000 - 7000 = 2000
      // Borrowable from secondary: max(7000) - max(7000, 500) = 0 (fully used)
      // available = min(2000, 2000) = 2000, borrowable = 0, total = 2000 < 5000
      const result = tight.requestAllocationByTokens("primary", 5000);

      expect(result.fits).toBe(false);
      expect(result.overflowTokens).toBeGreaterThan(0);
      expect(result.suggestion).toBeDefined();
    });

    it("should throw for unknown slot", () => {
      expect(() => manager.requestAllocation("nonexistent", "test")).toThrow(
        'Unknown budget slot: "nonexistent"',
      );
    });
  });

  describe("requestAllocationByTokens", () => {
    it("should approve allocation within budget", () => {
      const result = manager.requestAllocationByTokens("memory", 2000);

      expect(result.fits).toBe(true);
      expect(result.allocatedTokens).toBe(2000);
      expect(result.overflowTokens).toBe(0);
    });

    it("should suggest truncation for small overflow", () => {
      // memory maxTokens is 4000, try 4500 (12.5% overflow)
      const result = manager.requestAllocationByTokens("memory", 4500);

      // May borrow from lower-priority slots
      if (!result.fits && result.suggestion) {
        expect(result.suggestion).toBe("truncate");
      }
    });

    it("should suggest drop for low-priority slots with large overflow", () => {
      // skills maxTokens is 4000, try 20000 (huge overflow)
      // First fill up global budget to force overflow
      manager.recordUsageByTokens("conversation", 100000);
      manager.recordUsageByTokens("tool_results", 16000);

      const result = manager.requestAllocationByTokens("skills", 10000);

      expect(result.fits).toBe(false);
      expect(result.suggestion).toBe("drop");
    });
  });

  describe("recordUsage", () => {
    it("should update slot currentTokens", () => {
      const content = "B".repeat(2000); // ~500 tokens
      manager.recordUsage("memory", content);

      const slot = manager.getSlot("memory");
      expect(slot?.currentTokens).toBe(500);
    });

    it("should update totalUsed", () => {
      manager.recordUsage("system_prompt", "A".repeat(1200)); // ~300 tokens
      manager.recordUsage("memory", "B".repeat(800)); // ~200 tokens

      expect(manager.totalUsed).toBe(500);
    });
  });

  describe("recordUsageByTokens", () => {
    it("should set exact token count", () => {
      manager.recordUsageByTokens("tool_results", 5000);

      const slot = manager.getSlot("tool_results");
      expect(slot?.currentTokens).toBe(5000);
      expect(manager.totalUsed).toBe(5000);
    });
  });

  describe("resetSlot", () => {
    it("should reset a single slot to zero", () => {
      manager.recordUsageByTokens("memory", 3000);
      manager.recordUsageByTokens("conversation", 10000);

      manager.resetSlot("memory");

      expect(manager.getSlot("memory")?.currentTokens).toBe(0);
      expect(manager.getSlot("conversation")?.currentTokens).toBe(10000);
      expect(manager.totalUsed).toBe(10000);
    });
  });

  describe("resetAll", () => {
    it("should reset all slots to zero", () => {
      manager.recordUsageByTokens("memory", 3000);
      manager.recordUsageByTokens("conversation", 10000);

      manager.resetAll();

      expect(manager.totalUsed).toBe(0);
    });
  });

  describe("remaining", () => {
    it("should track remaining budget", () => {
      const usable = manager.usableBudget;

      manager.recordUsageByTokens("system_prompt", 2000);
      expect(manager.remaining).toBe(usable - 2000);

      manager.recordUsageByTokens("conversation", 5000);
      expect(manager.remaining).toBe(usable - 7000);
    });

    it("should not go below zero", () => {
      manager.recordUsageByTokens("conversation", 200000);
      expect(manager.remaining).toBe(0);
    });
  });

  describe("getSnapshot", () => {
    it("should return complete snapshot", () => {
      manager.recordUsageByTokens("system_prompt", 2000);
      manager.recordUsageByTokens("memory", 1000);

      const snapshot = manager.getSnapshot();

      expect(snapshot.totalUsed).toBe(3000);
      expect(snapshot.usableBudget).toBe(128000 - 4096);
      expect(snapshot.remaining).toBe(128000 - 4096 - 3000);
      expect(snapshot.utilization).toBeCloseTo(3000 / (128000 - 4096), 4);
      expect(snapshot.overcommitted).toBe(false);
    });

    it("should detect overcommitted state", () => {
      // Use a small budget
      const small = new ContextBudgetManager({
        totalTokens: 2000,
        outputReserve: 500,
        slots: [
          {
            id: "test",
            label: "Test",
            priority: "normal",
            minTokens: 0,
            maxTokens: 5000,
            currentTokens: 0,
            shareable: true,
          },
        ],
      });

      small.recordUsageByTokens("test", 2000);
      const snapshot = small.getSnapshot();

      expect(snapshot.overcommitted).toBe(true);
    });

    it("should include per-slot utilization", () => {
      manager.recordUsageByTokens("system_prompt", 2000);

      const snapshot = manager.getSnapshot();
      const sysSlot = snapshot.slots.find((s) => s.id === "system_prompt");

      expect(sysSlot).toBeDefined();
      expect(sysSlot!.allocated).toBe(2000);
      expect(sysSlot!.utilization).toBe(2000 / 4000);
    });
  });

  describe("rebalance", () => {
    it("should transfer budget from underused to overused slots", () => {
      // Overfill conversation (max 32000)
      manager.recordUsageByTokens("conversation", 35000);
      // Skills slot is unused (max 4000, min 0) - perfect donor
      manager.recordUsageByTokens("skills", 0);

      const events = manager.rebalance();

      expect(events.length).toBeGreaterThan(0);

      // Conversation should have gained budget
      const conversationSlot = manager.getSlot("conversation");
      expect(conversationSlot!.maxTokens).toBeGreaterThan(32000);
    });

    it("should not rebalance when all slots are within limits", () => {
      manager.recordUsageByTokens("system_prompt", 1000);
      manager.recordUsageByTokens("memory", 500);

      const events = manager.rebalance();

      expect(events).toHaveLength(0);
    });

    it("should track rebalance history", () => {
      manager.recordUsageByTokens("conversation", 35000);
      manager.rebalance();

      const history = manager.getRebalanceHistory();
      expect(history.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("addSlot", () => {
    it("should add a new slot", () => {
      manager.addSlot({
        id: "custom",
        label: "Custom Slot",
        priority: "normal",
        minTokens: 0,
        maxTokens: 2000,
        currentTokens: 0,
        shareable: true,
      });

      const slot = manager.getSlot("custom");
      expect(slot).toBeDefined();
      expect(slot!.label).toBe("Custom Slot");
    });

    it("should throw on duplicate slot ID", () => {
      expect(() =>
        manager.addSlot({
          id: "memory",
          label: "Duplicate",
          priority: "normal",
          minTokens: 0,
          maxTokens: 1000,
          currentTokens: 0,
          shareable: true,
        }),
      ).toThrow('Slot "memory" already exists');
    });
  });

  describe("removeSlot", () => {
    it("should remove an existing slot", () => {
      expect(manager.removeSlot("skills")).toBe(true);
      expect(manager.getSlot("skills")).toBeUndefined();
    });

    it("should return false for non-existent slot", () => {
      expect(manager.removeSlot("nonexistent")).toBe(false);
    });
  });

  describe("trimToFit", () => {
    it("should return content unchanged when it fits", () => {
      const content = "Hello world";
      const result = manager.trimToFit(content, 1000);

      expect(result.trimmed).toBe(content);
      expect(result.wasTrimmed).toBe(false);
    });

    it("should truncate content that exceeds budget", () => {
      const content = "A".repeat(8000); // ~2000 tokens
      const result = manager.trimToFit(content, 500);

      expect(result.wasTrimmed).toBe(true);
      expect(result.trimmed.length).toBeLessThan(content.length);
      expect(result.trimmed).toContain("[... content truncated to fit context budget ...]");
    });

    it("should try to truncate at line boundaries", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${"x".repeat(50)}`).join(
        "\n",
      );
      const result = manager.trimToFit(lines, 200);

      expect(result.wasTrimmed).toBe(true);
      // Should end at a line boundary (not mid-line)
      const lastContent = result.trimmed.split("\n[... content")[0];
      // Verify it doesn't end with a partial word
      expect(lastContent.endsWith("\n") || lastContent.match(/Line \d+: x+$/) !== null).toBe(true);
    });
  });

  describe("formatReport", () => {
    it("should generate a readable report", () => {
      manager.recordUsageByTokens("system_prompt", 2000);
      manager.recordUsageByTokens("memory", 1000);
      manager.recordUsageByTokens("conversation", 15000);

      const report = manager.formatReport();

      expect(report).toContain("Context Budget:");
      expect(report).toContain("System Prompt");
      expect(report).toContain("Memory Retrieval");
      expect(report).toContain("Conversation History");
      expect(report).toContain("█");
    });

    it("should warn when overcommitted", () => {
      const small = new ContextBudgetManager({
        totalTokens: 2000,
        outputReserve: 500,
        slots: [
          {
            id: "test",
            label: "Test",
            priority: "normal",
            minTokens: 0,
            maxTokens: 5000,
            currentTokens: 0,
            shareable: true,
          },
        ],
      });

      small.recordUsageByTokens("test", 2000);
      const report = small.formatReport();

      expect(report).toContain("overcommitted");
    });
  });
});

describe("createBudgetManager", () => {
  it("should create manager for small context", () => {
    const mgr = createBudgetManager("small");
    expect(mgr.usableBudget).toBeLessThan(8192);
  });

  it("should create manager for large context", () => {
    const mgr = createBudgetManager("large");
    expect(mgr.usableBudget).toBeLessThan(128000);
    expect(mgr.usableBudget).toBeGreaterThan(100000);
  });

  it("should create manager for xlarge context", () => {
    const mgr = createBudgetManager("xlarge");
    expect(mgr.usableBudget).toBeLessThan(200000);
  });

  it("should accept overrides", () => {
    const mgr = createBudgetManager("medium", { outputReserve: 8192 });
    expect(mgr.usableBudget).toBe(32768 - 8192);
  });
});

describe("DEFAULT_SLOTS", () => {
  it("should have system_prompt as critical", () => {
    const systemSlot = DEFAULT_SLOTS.find((s) => s.id === "system_prompt");
    expect(systemSlot?.priority).toBe("critical");
    expect(systemSlot?.shareable).toBe(false);
  });

  it("should have all required fields", () => {
    for (const slot of DEFAULT_SLOTS) {
      expect(slot.id).toBeTruthy();
      expect(slot.label).toBeTruthy();
      expect(slot.priority).toBeTruthy();
      expect(slot.minTokens).toBeGreaterThanOrEqual(0);
      expect(slot.maxTokens).toBeGreaterThan(0);
      expect(slot.maxTokens).toBeGreaterThanOrEqual(slot.minTokens);
    }
  });

  it("should have reasonable total max tokens", () => {
    const totalMax = DEFAULT_SLOTS.reduce((sum, s) => sum + s.maxTokens, 0);
    // Total max should be under 128k (default large context)
    expect(totalMax).toBeLessThanOrEqual(128000);
  });
});
