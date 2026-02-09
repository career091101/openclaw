/**
 * Stateful Multi-Step Planning with Checkpoints
 *
 * Inspired by LangGraph's StateGraph pattern for managing long-running agent
 * workflows with explicit state management and checkpoints.
 *
 * Benefits:
 * - Resume from failures without losing progress
 * - Track progress through complex multi-step tasks
 * - Enable debugging and replay of agent workflows
 * - Support branching and conditional execution paths
 *
 * Source: https://github.com/langchain-ai/langgraph
 */

export type StepId = string;
export type CheckpointId = string;

export interface PlanStep<TState = unknown> {
  id: StepId;
  name: string;
  description?: string;
  execute: (state: TState) => Promise<Partial<TState>>;
  shouldExecute?: (state: TState) => boolean | Promise<boolean>;
  onError?: (state: TState, error: Error) => Promise<Partial<TState> | "retry" | "abort">;
  maxRetries?: number;
}

export interface PlanState<TState = unknown> {
  /** Current state data */
  data: TState;
  /** Steps completed successfully */
  completedSteps: StepId[];
  /** Current step being executed */
  currentStep: StepId | null;
  /** Step execution history */
  history: StepExecutionRecord[];
  /** Plan metadata */
  metadata: {
    planId: string;
    createdAt: number;
    updatedAt: number;
    status: "pending" | "running" | "completed" | "failed" | "paused";
  };
}

export interface StepExecutionRecord {
  stepId: StepId;
  startedAt: number;
  completedAt: number | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  error?: string;
  retryCount: number;
  stateSnapshot?: unknown;
}

export interface Checkpoint<TState = unknown> {
  id: CheckpointId;
  planId: string;
  createdAt: number;
  state: PlanState<TState>;
  label?: string;
}

export interface CheckpointStorage {
  save<TState>(checkpoint: Checkpoint<TState>): Promise<void>;
  load<TState>(checkpointId: CheckpointId): Promise<Checkpoint<TState> | null>;
  list(planId: string): Promise<Checkpoint[]>;
  delete(checkpointId: CheckpointId): Promise<void>;
}

export interface StatefulPlanConfig {
  /** Enable automatic checkpointing after each step */
  autoCheckpoint: boolean;
  /** Checkpoint storage implementation */
  storage?: CheckpointStorage;
  /** Maximum retry attempts for failed steps */
  defaultMaxRetries: number;
  /** Enable detailed logging */
  verbose: boolean;
}

export const DEFAULT_PLAN_CONFIG: StatefulPlanConfig = {
  autoCheckpoint: true,
  defaultMaxRetries: 2,
  verbose: false,
};

/**
 * In-memory checkpoint storage for development/testing.
 * Production should use persistent storage (file system, database, etc.)
 */
export class InMemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints = new Map<CheckpointId, Checkpoint>();

  async save<TState>(checkpoint: Checkpoint<TState>): Promise<void> {
    this.checkpoints.set(checkpoint.id, checkpoint as Checkpoint);
  }

  async load<TState>(checkpointId: CheckpointId): Promise<Checkpoint<TState> | null> {
    const checkpoint = this.checkpoints.get(checkpointId);
    return (checkpoint as Checkpoint<TState>) || null;
  }

  async list(planId: string): Promise<Checkpoint[]> {
    return Array.from(this.checkpoints.values())
      .filter((cp) => cp.planId === planId)
      .toSorted((a, b) => b.createdAt - a.createdAt);
  }

  async delete(checkpointId: CheckpointId): Promise<void> {
    this.checkpoints.delete(checkpointId);
  }

  clear(): void {
    this.checkpoints.clear();
  }
}

/**
 * Stateful planner that manages multi-step workflows with checkpoint support.
 */
export class StatefulPlanner<TState = unknown> {
  private steps: PlanStep<TState>[] = [];
  private state: PlanState<TState>;
  private config: StatefulPlanConfig;
  private storage: CheckpointStorage;

  constructor(
    initialState: TState,
    planId: string = `plan_${Date.now()}`,
    config: Partial<StatefulPlanConfig> = {},
  ) {
    this.config = { ...DEFAULT_PLAN_CONFIG, ...config };
    this.storage = config.storage || new InMemoryCheckpointStorage();

    this.state = {
      data: initialState,
      completedSteps: [],
      currentStep: null,
      history: [],
      metadata: {
        planId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending",
      },
    };
  }

  /**
   * Add a step to the execution plan.
   */
  addStep(step: PlanStep<TState>): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Create a checkpoint of the current state.
   */
  async checkpoint(label?: string): Promise<CheckpointId> {
    const checkpointId = `cp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const checkpoint: Checkpoint<TState> = {
      id: checkpointId,
      planId: this.state.metadata.planId,
      createdAt: Date.now(),
      state: JSON.parse(JSON.stringify(this.state)), // Deep clone
      label,
    };

    await this.storage.save(checkpoint);

    if (this.config.verbose) {
      console.log(
        `[StatefulPlanner] Created checkpoint ${checkpointId}${label ? ` (${label})` : ""}`,
      );
    }

    return checkpointId;
  }

  /**
   * Restore state from a checkpoint.
   */
  async restore(checkpointId: CheckpointId): Promise<void> {
    const checkpoint = await this.storage.load<TState>(checkpointId);

    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    this.state = JSON.parse(JSON.stringify(checkpoint.state)); // Deep clone
    this.state.metadata.updatedAt = Date.now();

    if (this.config.verbose) {
      console.log(`[StatefulPlanner] Restored from checkpoint ${checkpointId}`);
    }
  }

  /**
   * Execute all steps in the plan.
   */
  async execute(): Promise<TState> {
    this.state.metadata.status = "running";
    this.state.metadata.updatedAt = Date.now();

    try {
      for (const step of this.steps) {
        // Skip if already completed
        if (this.state.completedSteps.includes(step.id)) {
          if (this.config.verbose) {
            console.log(`[StatefulPlanner] Skipping completed step: ${step.name}`);
          }
          continue;
        }

        // Check if step should execute
        if (step.shouldExecute && !(await step.shouldExecute(this.state.data))) {
          this.recordStepExecution(step.id, "skipped");
          continue;
        }

        // Execute step with retry logic
        await this.executeStepWithRetry(step);

        // Auto-checkpoint after each step
        if (this.config.autoCheckpoint) {
          await this.checkpoint(`after_${step.name}`);
        }
      }

      this.state.metadata.status = "completed";
      return this.state.data;
    } catch (error) {
      this.state.metadata.status = "failed";
      throw error;
    } finally {
      this.state.metadata.updatedAt = Date.now();
    }
  }

  /**
   * Execute a single step with retry logic.
   */
  private async executeStepWithRetry(step: PlanStep<TState>): Promise<void> {
    const maxRetries = step.maxRetries ?? this.config.defaultMaxRetries;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      this.state.currentStep = step.id;
      const record = this.recordStepExecution(step.id, "running");

      try {
        if (this.config.verbose) {
          console.log(
            `[StatefulPlanner] Executing step: ${step.name}${retryCount > 0 ? ` (retry ${retryCount})` : ""}`,
          );
        }

        const updates = await step.execute(this.state.data);

        // Merge updates into state
        this.state.data = { ...this.state.data, ...updates };
        this.state.completedSteps.push(step.id);
        this.state.currentStep = null;

        record.status = "completed";
        record.completedAt = Date.now();
        record.retryCount = retryCount;

        return; // Success!
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);

        if (step.onError) {
          const errorAction = await step.onError(this.state.data, error as Error);

          if (errorAction === "abort") {
            record.status = "failed";
            throw error;
          } else if (errorAction === "retry") {
            retryCount++;
            continue;
          } else {
            // errorAction is partial state update
            this.state.data = { ...this.state.data, ...errorAction };
            record.status = "completed";
            this.state.completedSteps.push(step.id);
            return;
          }
        }

        retryCount++;

        if (retryCount > maxRetries) {
          record.status = "failed";
          throw new Error(`Step ${step.name} failed after ${maxRetries} retries: ${record.error}`, {
            cause: error,
          });
        }
      }
    }
  }

  /**
   * Record step execution in history.
   */
  private recordStepExecution(
    stepId: StepId,
    status: StepExecutionRecord["status"],
  ): StepExecutionRecord {
    const existingRecord = this.state.history.find(
      (r) => r.stepId === stepId && r.completedAt === null,
    );

    if (existingRecord) {
      existingRecord.status = status;
      return existingRecord;
    }

    const record: StepExecutionRecord = {
      stepId,
      startedAt: Date.now(),
      completedAt: null,
      status,
      retryCount: 0,
    };

    this.state.history.push(record);
    return record;
  }

  /**
   * Get current plan state (for inspection/debugging).
   */
  getState(): Readonly<PlanState<TState>> {
    return this.state;
  }

  /**
   * Get all checkpoints for this plan.
   */
  async listCheckpoints(): Promise<Checkpoint<TState>[]> {
    return this.storage.list(this.state.metadata.planId) as Promise<Checkpoint<TState>[]>;
  }

  /**
   * Pause execution (sets status to paused).
   */
  pause(): void {
    this.state.metadata.status = "paused";
    this.state.metadata.updatedAt = Date.now();
  }

  /**
   * Resume execution from current state.
   */
  async resume(): Promise<TState> {
    this.state.metadata.status = "running";
    return this.execute();
  }
}

/**
 * Helper to create a simple plan from an array of steps.
 */
export function createPlan<TState>(
  initialState: TState,
  steps: PlanStep<TState>[],
  config?: Partial<StatefulPlanConfig>,
): StatefulPlanner<TState> {
  const planner = new StatefulPlanner(initialState, undefined, config);
  steps.forEach((step) => planner.addStep(step));
  return planner;
}
