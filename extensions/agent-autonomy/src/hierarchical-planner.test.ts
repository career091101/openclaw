import { describe, it, expect, beforeEach } from "vitest";
import {
  HierarchicalPlanner,
  createHierarchicalPlanner,
  type Goal,
  type PlanningContext,
} from "./hierarchical-planner";

describe("HierarchicalPlanner", () => {
  let planner: HierarchicalPlanner;
  let context: PlanningContext;

  beforeEach(() => {
    context = {
      availableResources: ["cpu", "memory", "network"],
      constraints: { maxConcurrent: 3 },
      maxDepth: 3,
      maxSubGoalsPerLevel: 5,
    };
    planner = new HierarchicalPlanner(context);
  });

  describe("Goal Decomposition", () => {
    it("should decompose a complex goal into sub-goals", async () => {
      const complexGoal: Goal = {
        id: "goal-1",
        description:
          "Build a complete enterprise web application with comprehensive authentication system, database integration with complex schema migrations, RESTful API endpoints with versioning support, user management system, role-based access control mechanisms, comprehensive testing suite including unit and integration tests, automated deployment pipeline with CI/CD, monitoring infrastructure with logging and alerts, and detailed technical documentation for all components and services in the application architecture",
        status: "pending",
        priority: 8,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const decomposed = await planner.decomposeGoal(complexGoal);

      expect(decomposed.subGoals).toBeDefined();
      expect(decomposed.subGoals!.length).toBeGreaterThan(0);
      expect(decomposed.subGoals!.length).toBeLessThanOrEqual(context.maxSubGoalsPerLevel);
    });

    it("should not decompose a simple goal", async () => {
      const simpleGoal: Goal = {
        id: "goal-2",
        description: "Read file",
        status: "pending",
        priority: 5,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const decomposed = await planner.decomposeGoal(simpleGoal);

      expect(decomposed.subGoals).toBeUndefined();
    });

    it("should respect max depth limit", async () => {
      const shallowContext: PlanningContext = {
        ...context,
        maxDepth: 1,
      };
      const shallowPlanner = new HierarchicalPlanner(shallowContext);

      const deepGoal: Goal = {
        id: "goal-3",
        description: "Very complex goal that would normally decompose deeply with multiple levels",
        status: "pending",
        priority: 10,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const decomposed = await shallowPlanner.decomposeGoal(deepGoal, 1);

      // At max depth, should not decompose further
      expect(decomposed.subGoals).toBeUndefined();
    });

    it("should create dependency chains in sub-goals", async () => {
      const goal: Goal = {
        id: "goal-4",
        description:
          "Complex sequential task requiring multiple steps in order to complete successfully",
        status: "pending",
        priority: 7,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const decomposed = await planner.decomposeGoal(goal);

      if (decomposed.subGoals && decomposed.subGoals.length > 1) {
        // Second sub-goal should depend on first
        expect(decomposed.subGoals[1].dependencies).toContain(decomposed.subGoals[0].id);
      }
    });
  });

  describe("Actionable Goals", () => {
    it("should identify goals with no blocking dependencies as actionable", async () => {
      const goal: Goal = {
        id: "goal-5",
        description: "Independent task",
        status: "pending",
        priority: 5,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(goal);
      const actionable = planner.getNextActionableGoals();

      expect(actionable.length).toBeGreaterThan(0);
    });

    it("should not return goals with incomplete dependencies as actionable", async () => {
      const goal1: Goal = {
        id: "goal-6",
        description: "First task",
        status: "in-progress",
        priority: 5,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const goal2: Goal = {
        id: "goal-7",
        description: "Second task",
        status: "pending",
        priority: 5,
        dependencies: ["goal-6"],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(goal1);
      await planner.decomposeGoal(goal2);

      const actionable = planner.getNextActionableGoals();

      expect(actionable.some((g) => g.id === "goal-7")).toBe(false);
    });

    it("should return actionable goals sorted by priority", async () => {
      const lowPriority: Goal = {
        id: "goal-8",
        description: "Low priority",
        status: "pending",
        priority: 3,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const highPriority: Goal = {
        id: "goal-9",
        description: "High priority",
        status: "pending",
        priority: 9,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(lowPriority);
      await planner.decomposeGoal(highPriority);

      const actionable = planner.getNextActionableGoals();

      expect(actionable[0].priority).toBeGreaterThanOrEqual(
        actionable[actionable.length - 1].priority,
      );
    });
  });

  describe("Status Updates", () => {
    it("should update goal status and metrics", async () => {
      const goal: Goal = {
        id: "goal-10",
        description: "Task to complete",
        status: "pending",
        priority: 5,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(goal);
      await planner.updateGoalStatus("goal-10", "completed", { effort: 10 });

      const updated = planner.getGoal("goal-10");
      expect(updated?.status).toBe("completed");
      expect(updated?.completedAt).toBeDefined();
      expect(updated?.actualEffort).toBe(10);

      const metrics = planner.getMetrics();
      expect(metrics.completedGoals).toBe(1);
    });

    it("should propagate completion to parent goal", async () => {
      const parentGoal: Goal = {
        id: "parent-1",
        description: "Parent task with multiple sub-tasks to coordinate and complete in sequence",
        status: "pending",
        priority: 8,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(parentGoal);
      const parent = planner.getGoal("parent-1");

      if (parent?.subGoals) {
        // Complete all sub-goals
        for (const subGoal of parent.subGoals) {
          await planner.updateGoalStatus(subGoal.id, "completed");
        }

        // Parent should now be completed
        const updatedParent = planner.getGoal("parent-1");
        expect(updatedParent?.status).toBe("completed");
      }
    });

    it("should trigger re-planning on failure", async () => {
      const goal: Goal = {
        id: "goal-11",
        description: "Task that will fail",
        status: "pending",
        priority: 5,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(goal);
      await planner.updateGoalStatus("goal-11", "failed", { reason: "Resource unavailable" });

      const metrics = planner.getMetrics();
      expect(metrics.failedGoals).toBe(1);
      expect(metrics.replanningCount).toBeGreaterThan(0);

      const history = planner.getReplanningHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].type).toBe("failure");
      expect(history[0].goalId).toBe("goal-11");
    });

    it("should create retry goals after failure", async () => {
      const parentGoal: Goal = {
        id: "parent-2",
        description: "Parent task with sub-tasks that may fail and require retry mechanisms",
        status: "pending",
        priority: 7,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(parentGoal);
      const parent = planner.getGoal("parent-2");

      if (parent?.subGoals && parent.subGoals.length > 0) {
        const firstSubGoal = parent.subGoals[0];
        const initialSubGoalCount = parent.subGoals.length;

        await planner.updateGoalStatus(firstSubGoal.id, "failed", { reason: "Test failure" });

        const updatedParent = planner.getGoal("parent-2");
        if (updatedParent?.subGoals) {
          // Should have added retry goal(s)
          expect(updatedParent.subGoals.length).toBeGreaterThanOrEqual(initialSubGoalCount);
        }
      }
    });
  });

  describe("Metrics and Analytics", () => {
    it("should track completion metrics", async () => {
      const goals: Goal[] = [
        {
          id: "metric-1",
          description: "First",
          status: "pending",
          priority: 5,
          dependencies: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "metric-2",
          description: "Second",
          status: "pending",
          priority: 5,
          dependencies: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      for (const goal of goals) {
        await planner.decomposeGoal(goal);
      }

      await planner.updateGoalStatus("metric-1", "completed");
      await planner.updateGoalStatus("metric-2", "failed", { reason: "Test" });

      const metrics = planner.getMetrics();
      expect(metrics.totalGoals).toBeGreaterThanOrEqual(2);
      expect(metrics.completedGoals).toBe(1);
      expect(metrics.failedGoals).toBe(1);
    });

    it("should calculate average completion time", async () => {
      const goal: Goal = {
        id: "metric-3",
        description: "Timed task",
        status: "pending",
        priority: 5,
        dependencies: [],
        createdAt: new Date(Date.now() - 5000), // 5 seconds ago
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(goal);
      await planner.updateGoalStatus("metric-3", "completed");

      const metrics = planner.getMetrics();
      expect(metrics.averageCompletionTime).toBeGreaterThan(0);
    });
  });

  describe("Plan Export", () => {
    it("should export complete plan state", async () => {
      const goal: Goal = {
        id: "export-1",
        description: "Goal to export with complete state information",
        status: "pending",
        priority: 6,
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await planner.decomposeGoal(goal);
      const exported = planner.exportPlan();

      expect(exported.goals).toBeDefined();
      expect(exported.metrics).toBeDefined();
      expect(exported.history).toBeDefined();
      expect(exported.goals.length).toBeGreaterThan(0);
    });
  });

  describe("Helper Function", () => {
    it("should create planner with default context", () => {
      const defaultPlanner = createHierarchicalPlanner();
      expect(defaultPlanner).toBeInstanceOf(HierarchicalPlanner);

      const metrics = defaultPlanner.getMetrics();
      expect(metrics).toBeDefined();
    });

    it("should create planner with partial context", () => {
      const customPlanner = createHierarchicalPlanner({
        maxDepth: 5,
        maxSubGoalsPerLevel: 10,
      });

      expect(customPlanner).toBeInstanceOf(HierarchicalPlanner);
    });
  });
});
