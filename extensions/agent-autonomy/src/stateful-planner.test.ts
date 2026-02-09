/**
 * Tests for Stateful Planner
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  StatefulPlanner,
  createPlan,
  InMemoryCheckpointStorage,
  PlanStep,
} from "./stateful-planner";

interface TestState {
  value: number;
  log: string[];
  error?: string;
}

describe("StatefulPlanner", () => {
  let planner: StatefulPlanner<TestState>;
  let storage: InMemoryCheckpointStorage;

  beforeEach(() => {
    storage = new InMemoryCheckpointStorage();
    planner = new StatefulPlanner<TestState>({ value: 0, log: [] }, "test_plan", {
      storage,
      verbose: false,
    });
  });

  describe("Basic Execution", () => {
    it("should execute steps in order", async () => {
      planner
        .addStep({
          id: "step1",
          name: "Increment",
          execute: async (state) => ({ value: state.value + 1 }),
        })
        .addStep({
          id: "step2",
          name: "Double",
          execute: async (state) => ({ value: state.value * 2 }),
        })
        .addStep({
          id: "step3",
          name: "Log",
          execute: async (state) => ({ log: [...state.log, `Final: ${state.value}`] }),
        });

      const result = await planner.execute();

      expect(result.value).toBe(2); // (0 + 1) * 2 = 2
      expect(result.log).toEqual(["Final: 2"]);
    });

    it("should track completed steps", async () => {
      planner
        .addStep({
          id: "step1",
          name: "Step 1",
          execute: async (state) => ({ value: state.value + 1 }),
        })
        .addStep({
          id: "step2",
          name: "Step 2",
          execute: async (state) => ({ value: state.value + 1 }),
        });

      await planner.execute();
      const state = planner.getState();

      expect(state.completedSteps).toEqual(["step1", "step2"]);
      expect(state.metadata.status).toBe("completed");
    });

    it("should skip steps based on shouldExecute", async () => {
      planner
        .addStep({
          id: "step1",
          name: "Always Execute",
          execute: async (_state) => ({ value: 10 }),
        })
        .addStep({
          id: "step2",
          name: "Conditional",
          shouldExecute: async (state) => state.value > 20,
          execute: async (state) => ({ value: state.value + 100 }),
        })
        .addStep({
          id: "step3",
          name: "Final",
          execute: async (state) => ({ value: state.value + 1 }),
        });

      const result = await planner.execute();

      expect(result.value).toBe(11); // step2 was skipped
      const state = planner.getState();
      expect(state.completedSteps).toEqual(["step1", "step3"]);
    });
  });

  describe("Checkpoints", () => {
    it("should create and restore checkpoints", async () => {
      planner.addStep({
        id: "step1",
        name: "Set Value",
        execute: async () => ({ value: 42, log: ["checkpoint test"] }),
      });

      await planner.execute();
      const checkpointId = await planner.checkpoint("after_execution");

      // Create new planner and restore
      const newPlanner = new StatefulPlanner<TestState>({ value: 0, log: [] }, "test_plan", {
        storage,
      });

      await newPlanner.restore(checkpointId);
      const state = newPlanner.getState();

      expect(state.data.value).toBe(42);
      expect(state.data.log).toEqual(["checkpoint test"]);
      expect(state.completedSteps).toEqual(["step1"]);
    });

    it("should auto-checkpoint after each step when enabled", async () => {
      const autoPlanner = new StatefulPlanner<TestState>({ value: 0, log: [] }, "auto_plan", {
        storage,
        autoCheckpoint: true,
      });

      autoPlanner
        .addStep({
          id: "step1",
          name: "Step 1",
          execute: async (state) => ({ value: state.value + 1 }),
        })
        .addStep({
          id: "step2",
          name: "Step 2",
          execute: async (state) => ({ value: state.value + 1 }),
        });

      await autoPlanner.execute();

      const checkpoints = await autoPlanner.listCheckpoints();
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      expect(checkpoints.some((cp) => cp.label?.includes("after_"))).toBe(true);
    });

    it("should list checkpoints for a plan", async () => {
      await planner.checkpoint("checkpoint_1");
      await planner.checkpoint("checkpoint_2");
      await planner.checkpoint("checkpoint_3");

      const checkpoints = await planner.listCheckpoints();

      expect(checkpoints.length).toBe(3);
      expect(checkpoints[0].label).toBe("checkpoint_3"); // Most recent first
    });
  });

  describe("Error Handling", () => {
    it("should retry failed steps", async () => {
      let attempts = 0;

      planner.addStep({
        id: "flaky_step",
        name: "Flaky",
        maxRetries: 2,
        execute: async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error("Temporary failure");
          }
          return { value: 100 };
        },
      });

      const result = await planner.execute();

      expect(result.value).toBe(100);
      expect(attempts).toBe(2);
    });

    it("should fail after max retries", async () => {
      planner.addStep({
        id: "always_fail",
        name: "Always Fails",
        maxRetries: 1,
        execute: async () => {
          throw new Error("Persistent error");
        },
      });

      await expect(planner.execute()).rejects.toThrow("Persistent error");

      const state = planner.getState();
      expect(state.metadata.status).toBe("failed");
    });

    it("should handle errors with onError callback", async () => {
      planner.addStep({
        id: "error_handler",
        name: "Error Handler",
        execute: async () => {
          throw new Error("Expected error");
        },
        onError: async (state, error) => {
          return { error: error.message, value: -1 };
        },
      });

      const result = await planner.execute();

      expect(result.value).toBe(-1);
      expect(result.error).toBe("Expected error");
      expect(planner.getState().completedSteps).toContain("error_handler");
    });

    it("should abort on error when onError returns 'abort'", async () => {
      planner
        .addStep({
          id: "step1",
          name: "Success",
          execute: async () => ({ value: 10 }),
        })
        .addStep({
          id: "step2",
          name: "Abort",
          execute: async () => {
            throw new Error("Abort me");
          },
          onError: async () => "abort" as const,
        })
        .addStep({
          id: "step3",
          name: "Never Reached",
          execute: async () => ({ value: 999 }),
        });

      await expect(planner.execute()).rejects.toThrow();

      const state = planner.getState();
      expect(state.completedSteps).toEqual(["step1"]);
      expect(state.completedSteps).not.toContain("step3");
    });
  });

  describe("Resume from Checkpoint", () => {
    it("should resume execution from checkpoint", async () => {
      const plan = createPlan<TestState>(
        { value: 0, log: [] },
        [
          {
            id: "step1",
            name: "Step 1",
            execute: async (state) => ({ value: state.value + 1 }),
          },
          {
            id: "step2",
            name: "Step 2",
            execute: async (state) => ({ value: state.value + 1 }),
          },
          {
            id: "step3",
            name: "Step 3",
            execute: async (state) => ({ value: state.value + 1 }),
          },
        ],
        { storage, autoCheckpoint: true },
      );

      // Execute first two steps
      plan.addStep({
        id: "step1",
        name: "Step 1",
        execute: async (state) => {
          return { value: state.value + 1 };
        },
      });

      plan.addStep({
        id: "step2",
        name: "Step 2",
        execute: async (_state) => {
          // Simulate failure after step 2
          throw new Error("Simulated failure");
        },
      });

      try {
        await plan.execute();
      } catch {
        // Expected failure
      }

      // Get checkpoint after step 1
      const checkpoints = await plan.listCheckpoints();
      const afterStep1 = checkpoints.find((cp) => cp.label?.includes("after_Step 1"));

      expect(afterStep1).toBeDefined();

      // Restore and continue
      const resumePlan = new StatefulPlanner<TestState>(
        { value: 0, log: [] },
        plan.getState().metadata.planId,
        { storage },
      );

      await resumePlan.restore(afterStep1!.id);

      // Add remaining steps
      resumePlan.addStep({
        id: "step2",
        name: "Step 2 (Fixed)",
        execute: async (state) => ({ value: state.value + 1 }),
      });

      resumePlan.addStep({
        id: "step3",
        name: "Step 3",
        execute: async (state) => ({ value: state.value + 1 }),
      });

      const result = await resumePlan.execute();

      // Should skip step1 (already completed), execute step2 and step3
      expect(result.value).toBe(3);
    });
  });

  describe("Pause and Resume", () => {
    it("should pause and resume execution", async () => {
      const plan = createPlan<TestState>({ value: 0, log: [] }, [
        {
          id: "step1",
          name: "Step 1",
          execute: async (state) => ({ value: state.value + 1 }),
        },
      ]);

      plan.pause();
      expect(plan.getState().metadata.status).toBe("paused");

      const result = await plan.resume();
      expect(result.value).toBe(1);
      expect(plan.getState().metadata.status).toBe("completed");
    });
  });

  describe("createPlan Helper", () => {
    it("should create a plan with helper function", async () => {
      const steps: PlanStep<TestState>[] = [
        {
          id: "add",
          name: "Add",
          execute: async (state) => ({ value: state.value + 5 }),
        },
        {
          id: "multiply",
          name: "Multiply",
          execute: async (state) => ({ value: state.value * 2 }),
        },
      ];

      const plan = createPlan({ value: 10, log: [] }, steps);
      const result = await plan.execute();

      expect(result.value).toBe(30); // (10 + 5) * 2
    });
  });
});

describe("InMemoryCheckpointStorage", () => {
  let storage: InMemoryCheckpointStorage;

  beforeEach(() => {
    storage = new InMemoryCheckpointStorage();
  });

  it("should save and load checkpoints", async () => {
    const checkpoint = {
      id: "cp1",
      planId: "plan1",
      createdAt: Date.now(),
      state: {
        data: { value: 42 },
        completedSteps: [],
        currentStep: null,
        history: [],
        metadata: {
          planId: "plan1",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "pending" as const,
        },
      },
    };

    await storage.save(checkpoint);
    const loaded = await storage.load("cp1");

    expect(loaded).toEqual(checkpoint);
  });

  it("should list checkpoints by planId", async () => {
    await storage.save({
      id: "cp1",
      planId: "plan1",
      createdAt: 1000,
      state: {} as unknown,
    });

    await storage.save({
      id: "cp2",
      planId: "plan1",
      createdAt: 2000,
      state: {} as unknown,
    });

    await storage.save({
      id: "cp3",
      planId: "plan2",
      createdAt: 3000,
      state: {} as unknown,
    });

    const plan1Checkpoints = await storage.list("plan1");

    expect(plan1Checkpoints.length).toBe(2);
    expect(plan1Checkpoints[0].id).toBe("cp2"); // Most recent first
    expect(plan1Checkpoints[1].id).toBe("cp1");
  });

  it("should delete checkpoints", async () => {
    await storage.save({
      id: "cp1",
      planId: "plan1",
      createdAt: Date.now(),
      state: {} as unknown,
    });

    await storage.delete("cp1");
    const loaded = await storage.load("cp1");

    expect(loaded).toBeNull();
  });

  it("should clear all checkpoints", async () => {
    await storage.save({
      id: "cp1",
      planId: "plan1",
      createdAt: Date.now(),
      state: {} as unknown,
    });

    await storage.save({
      id: "cp2",
      planId: "plan2",
      createdAt: Date.now(),
      state: {} as unknown,
    });

    storage.clear();

    const loaded1 = await storage.load("cp1");
    const loaded2 = await storage.load("cp2");

    expect(loaded1).toBeNull();
    expect(loaded2).toBeNull();
  });
});
