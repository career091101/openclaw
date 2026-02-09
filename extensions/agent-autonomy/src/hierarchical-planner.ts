/**
 * Hierarchical Goal Decomposition with Dynamic Re-planning
 *
 * This module provides capabilities for breaking down complex goals into
 * hierarchical sub-goals with dynamic re-planning based on execution progress.
 *
 * Key Features:
 * - Recursive goal decomposition into actionable sub-goals
 * - Dependency tracking between sub-goals
 * - Progress monitoring and adaptive re-planning
 * - Failure recovery with fallback strategies
 */

export interface Goal {
  id: string;
  description: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "blocked";
  priority: number; // Higher = more important
  estimatedEffort?: number; // In abstract units
  actualEffort?: number;
  dependencies: string[]; // IDs of goals that must complete first
  subGoals?: Goal[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  failureReason?: string;
}

export interface PlanningContext {
  availableResources: string[];
  constraints: Record<string, unknown>;
  maxDepth: number;
  maxSubGoalsPerLevel: number;
}

export interface ReplanningTrigger {
  type: "failure" | "blocked" | "resource-unavailable" | "progress-stalled";
  goalId: string;
  reason: string;
  timestamp: Date;
}

export interface PlanMetrics {
  totalGoals: number;
  completedGoals: number;
  failedGoals: number;
  blockedGoals: number;
  averageCompletionTime: number;
  replanningCount: number;
}

/**
 * Hierarchical Planner that decomposes goals and adapts plans dynamically
 */
export class HierarchicalPlanner {
  private goals: Map<string, Goal> = new Map();
  private replanningHistory: ReplanningTrigger[] = [];
  private metrics: PlanMetrics = {
    totalGoals: 0,
    completedGoals: 0,
    failedGoals: 0,
    blockedGoals: 0,
    averageCompletionTime: 0,
    replanningCount: 0,
  };

  constructor(private context: PlanningContext) {}

  /**
   * Decompose a high-level goal into hierarchical sub-goals
   */
  async decomposeGoal(goal: Goal, depth: number = 0): Promise<Goal> {
    if (depth >= this.context.maxDepth) {
      return goal;
    }

    // Simple heuristic-based decomposition
    // In practice, this would use LLM or domain-specific rules
    const complexity = this.estimateComplexity(goal);

    if (complexity > 3) {
      const subGoals = await this.generateSubGoals(goal, complexity);
      goal.subGoals = subGoals;

      // Recursively decompose sub-goals
      for (const subGoal of subGoals) {
        await this.decomposeGoal(subGoal, depth + 1);
        this.goals.set(subGoal.id, subGoal);
      }
    }

    this.goals.set(goal.id, goal);
    this.metrics.totalGoals++;
    return goal;
  }

  /**
   * Get next actionable goals (no blocking dependencies)
   */
  getNextActionableGoals(rootGoalId?: string): Goal[] {
    const actionable: Goal[] = [];
    const goalsToCheck = rootGoalId
      ? this.getDescendants(rootGoalId)
      : Array.from(this.goals.values());

    for (const goal of goalsToCheck) {
      if (this.isActionable(goal)) {
        actionable.push(goal);
      }
    }

    // Sort by priority (descending)
    return actionable.toSorted((a, b) => b.priority - a.priority);
  }

  /**
   * Check if a goal is actionable (ready to execute)
   */
  private isActionable(goal: Goal): boolean {
    if (goal.status !== "pending") {
      return false;
    }

    // Check if all dependencies are completed
    for (const depId of goal.dependencies) {
      const dep = this.goals.get(depId);
      if (!dep || dep.status !== "completed") {
        return false;
      }
    }

    // Check if goal has sub-goals (if so, not directly actionable)
    if (goal.subGoals && goal.subGoals.length > 0) {
      return false;
    }

    return true;
  }

  /**
   * Update goal status and trigger re-planning if needed
   */
  async updateGoalStatus(
    goalId: string,
    status: Goal["status"],
    metadata?: { effort?: number; reason?: string },
  ): Promise<void> {
    const goal = this.goals.get(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    goal.status = status;
    goal.updatedAt = new Date();

    if (metadata?.effort) {
      goal.actualEffort = metadata.effort;
    }

    if (status === "completed") {
      goal.completedAt = new Date();
      this.metrics.completedGoals++;
      this.updateMetrics();
    } else if (status === "failed") {
      goal.failureReason = metadata?.reason;
      this.metrics.failedGoals++;

      // Trigger re-planning on failure
      await this.handleFailure(goalId, metadata?.reason || "Unknown failure");
    } else if (status === "blocked") {
      this.metrics.blockedGoals++;
    }

    // Check if parent goal can now progress
    if (status === "completed" || status === "failed") {
      await this.propagateStatusToParent(goalId);
    }
  }

  /**
   * Handle goal failure with dynamic re-planning
   */
  private async handleFailure(goalId: string, reason: string): Promise<void> {
    const trigger: ReplanningTrigger = {
      type: "failure",
      goalId,
      reason,
      timestamp: new Date(),
    };

    this.replanningHistory.push(trigger);
    this.metrics.replanningCount++;

    const goal = this.goals.get(goalId);
    if (!goal) {
      return;
    }

    // Strategy 1: Try to find alternative decomposition
    const parent = this.findParentGoal(goalId);
    if (parent && parent.subGoals) {
      // Remove failed goal and try alternative decomposition
      parent.subGoals = parent.subGoals.filter((sg) => sg.id !== goalId);

      // Generate new alternative sub-goals
      const alternatives = await this.generateAlternativeSubGoals(goal);
      parent.subGoals.push(...alternatives);

      for (const alt of alternatives) {
        this.goals.set(alt.id, alt);
        this.metrics.totalGoals++;
      }
    }

    // Strategy 2: Adjust priorities of remaining goals
    this.adjustPriorities(goalId);
  }

  /**
   * Propagate completion status to parent goals
   */
  private async propagateStatusToParent(goalId: string): Promise<void> {
    const parent = this.findParentGoal(goalId);
    if (!parent || !parent.subGoals) {
      return;
    }

    // Check if all sub-goals are complete or failed
    const allComplete = parent.subGoals.every(
      (sg) => sg.status === "completed" || sg.status === "failed",
    );

    if (allComplete) {
      const anyFailed = parent.subGoals.some((sg) => sg.status === "failed");

      if (anyFailed) {
        // Parent fails if any critical sub-goal failed
        const criticalFailed = parent.subGoals.some(
          (sg) => sg.status === "failed" && sg.priority >= 8,
        );

        if (criticalFailed) {
          await this.updateGoalStatus(parent.id, "failed", {
            reason: "Critical sub-goal failed",
          });
        } else {
          // Partial success
          await this.updateGoalStatus(parent.id, "completed", {
            effort: parent.subGoals.reduce((sum, sg) => sum + (sg.actualEffort || 0), 0),
          });
        }
      } else {
        await this.updateGoalStatus(parent.id, "completed", {
          effort: parent.subGoals.reduce((sum, sg) => sum + (sg.actualEffort || 0), 0),
        });
      }
    }
  }

  /**
   * Get current plan metrics
   */
  getMetrics(): PlanMetrics {
    return { ...this.metrics };
  }

  /**
   * Get planning history for analysis
   */
  getReplanningHistory(): ReplanningTrigger[] {
    return [...this.replanningHistory];
  }

  /**
   * Estimate goal complexity (simple heuristic)
   */
  private estimateComplexity(goal: Goal): number {
    const descLength = goal.description.length;
    const depCount = goal.dependencies.length;

    // Simple heuristic: longer description and more dependencies = more complex
    return Math.min(10, Math.floor(descLength / 50) + depCount);
  }

  /**
   * Generate sub-goals for a complex goal
   */
  private async generateSubGoals(goal: Goal, complexity: number): Promise<Goal[]> {
    const subGoalCount = Math.min(this.context.maxSubGoalsPerLevel, Math.ceil(complexity / 2));

    const subGoals: Goal[] = [];
    for (let i = 0; i < subGoalCount; i++) {
      const subGoal: Goal = {
        id: `${goal.id}-sub-${i}`,
        description: `Sub-task ${i + 1} of: ${goal.description}`,
        status: "pending",
        priority: goal.priority,
        dependencies: i > 0 ? [`${goal.id}-sub-${i - 1}`] : [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      subGoals.push(subGoal);
    }

    return subGoals;
  }

  /**
   * Generate alternative sub-goals after failure
   */
  private async generateAlternativeSubGoals(failedGoal: Goal): Promise<Goal[]> {
    // Simple fallback: create a single retry goal with lower complexity
    const retryGoal: Goal = {
      id: `${failedGoal.id}-retry-${Date.now()}`,
      description: `Retry: ${failedGoal.description}`,
      status: "pending",
      priority: Math.max(1, failedGoal.priority - 1),
      dependencies: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { isRetry: true, originalGoalId: failedGoal.id },
    };

    return [retryGoal];
  }

  /**
   * Adjust priorities after a goal failure
   */
  private adjustPriorities(failedGoalId: string): void {
    const failedGoal = this.goals.get(failedGoalId);
    if (!failedGoal) {
      return;
    }

    // Boost priority of sibling goals
    const parent = this.findParentGoal(failedGoalId);
    if (parent && parent.subGoals) {
      for (const sibling of parent.subGoals) {
        if (sibling.id !== failedGoalId && sibling.status === "pending") {
          sibling.priority = Math.min(10, sibling.priority + 1);
        }
      }
    }
  }

  /**
   * Find parent goal
   */
  private findParentGoal(childId: string): Goal | undefined {
    for (const goal of this.goals.values()) {
      if (goal.subGoals?.some((sg) => sg.id === childId)) {
        return goal;
      }
    }
    return undefined;
  }

  /**
   * Get all descendant goals
   */
  private getDescendants(goalId: string): Goal[] {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return [];
    }

    const descendants: Goal[] = [goal];
    if (goal.subGoals) {
      for (const subGoal of goal.subGoals) {
        descendants.push(...this.getDescendants(subGoal.id));
      }
    }

    return descendants;
  }

  /**
   * Update average metrics
   */
  private updateMetrics(): void {
    const completedGoals = Array.from(this.goals.values()).filter(
      (g) => g.status === "completed" && g.completedAt && g.createdAt,
    );

    if (completedGoals.length > 0) {
      const totalTime = completedGoals.reduce((sum, g) => {
        const duration = g.completedAt!.getTime() - g.createdAt.getTime();
        return sum + duration;
      }, 0);

      this.metrics.averageCompletionTime = totalTime / completedGoals.length;
    }
  }

  /**
   * Get goal by ID
   */
  getGoal(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  /**
   * Export current plan state
   */
  exportPlan(): { goals: Goal[]; metrics: PlanMetrics; history: ReplanningTrigger[] } {
    return {
      goals: Array.from(this.goals.values()),
      metrics: this.getMetrics(),
      history: this.getReplanningHistory(),
    };
  }
}

/**
 * Create a new hierarchical planner with default context
 */
export function createHierarchicalPlanner(context?: Partial<PlanningContext>): HierarchicalPlanner {
  const defaultContext: PlanningContext = {
    availableResources: [],
    constraints: {},
    maxDepth: 3,
    maxSubGoalsPerLevel: 5,
    ...context,
  };

  return new HierarchicalPlanner(defaultContext);
}
