/**
 * Interpretability Hooks for Agent Decision Transparency
 *
 * Provides structured logging of agent decision-making processes, enabling
 * transparency, debugging, auditing, and continuous improvement. Inspired by
 * Anthropic's circuit tracing research for understanding model reasoning paths.
 *
 * Benefits:
 * - Understand why agents chose specific tools or approaches
 * - Debug unexpected agent behavior with detailed rationales
 * - Audit agent actions for compliance and safety
 * - Identify patterns for improvement (low confidence, repeated failures)
 * - Build trust through transparency of decision-making
 *
 * Source: https://www.anthropic.com/research/tracing-thoughts-language-model
 */

export type DecisionId = string;
export type ContextId = string;

/**
 * Confidence level for agent decisions.
 * - high: Agent is very confident (>0.8)
 * - medium: Reasonable confidence (0.5-0.8)
 * - low: Uncertain, may need human review (<0.5)
 */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Type of decision being made.
 */
export type DecisionType =
  | "tool_selection"
  | "parameter_choice"
  | "strategy_selection"
  | "error_recovery"
  | "task_decomposition"
  | "resource_allocation"
  | "escalation"
  | "other";

/**
 * A single agent decision with full transparency context.
 */
export interface DecisionLog {
  /** Unique identifier for this decision */
  id: DecisionId;
  /** Type of decision */
  type: DecisionType;
  /** Timestamp when decision was made */
  timestamp: number;
  /** Session or context ID for grouping related decisions */
  contextId?: ContextId;
  /** Human-readable description of the decision */
  description: string;
  /** The chosen option/action */
  choice: string;
  /** Alternative options that were considered */
  alternatives?: string[];
  /** Rationale for why this choice was made */
  rationale: string;
  /** Confidence score (0-1) in this decision */
  confidence: number;
  /** Confidence level category */
  confidenceLevel: ConfidenceLevel;
  /** Factors that influenced this decision */
  influencingFactors?: InfluencingFactor[];
  /** Related decision IDs (dependencies) */
  relatedDecisions?: DecisionId[];
  /** Outcome of this decision (if known) */
  outcome?: DecisionOutcome;
  /** Metadata for additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Factor that influenced a decision.
 */
export interface InfluencingFactor {
  /** Name of the factor */
  name: string;
  /** Weight/importance (0-1) */
  weight: number;
  /** Description of how it influenced the decision */
  description: string;
  /** Supporting data */
  data?: unknown;
}

/**
 * Outcome of a decision after execution.
 */
export interface DecisionOutcome {
  /** Whether the decision was successful */
  success: boolean;
  /** Time taken to execute (ms) */
  executionTimeMs?: number;
  /** Result data */
  result?: unknown;
  /** Error if failed */
  error?: string;
  /** Lessons learned */
  reflection?: string;
  /** Updated confidence based on outcome */
  revisedConfidence?: number;
}

/**
 * Tool selection rationale with detailed reasoning.
 */
export interface ToolSelectionRationale {
  /** Tool that was selected */
  selectedTool: string;
  /** Reason for selection */
  reason: string;
  /** Why other tools were not chosen */
  rejectedTools?: Array<{
    tool: string;
    reason: string;
  }>;
  /** Expected outcome from using this tool */
  expectedOutcome: string;
  /** Confidence in tool choice (0-1) */
  confidence: number;
  /** Parameters and why they were chosen */
  parameterRationale?: Record<string, string>;
}

/**
 * Storage interface for decision logs.
 */
export interface DecisionStorage {
  saveDecision(decision: DecisionLog): Promise<void>;
  loadDecisions(contextId?: ContextId, limit?: number): Promise<DecisionLog[]>;
  updateOutcome(decisionId: DecisionId, outcome: DecisionOutcome): Promise<void>;
  getDecisionById(decisionId: DecisionId): Promise<DecisionLog | null>;
  queryByConfidence(level: ConfidenceLevel, limit?: number): Promise<DecisionLog[]>;
  queryByType(type: DecisionType, limit?: number): Promise<DecisionLog[]>;
}

/**
 * Configuration for interpretability logging.
 */
export interface InterpretabilityConfig {
  /** Enable logging */
  enabled: boolean;
  /** Minimum confidence to log (skip high-confidence routine decisions) */
  minConfidenceToLog: number;
  /** Maximum decisions to keep in memory */
  maxDecisionsInMemory: number;
  /** Storage implementation */
  storage?: DecisionStorage;
  /** Enable verbose console output */
  verbose: boolean;
  /** Include detailed metadata */
  includeMetadata: boolean;
}

export const DEFAULT_INTERPRETABILITY_CONFIG: InterpretabilityConfig = {
  enabled: true,
  minConfidenceToLog: 0.0, // Log all decisions by default
  maxDecisionsInMemory: 1000,
  verbose: false,
  includeMetadata: true,
};

/**
 * In-memory decision storage for development/testing.
 * Production should use file-based storage (e.g., memory/decisions/*.json)
 */
export class InMemoryDecisionStorage implements DecisionStorage {
  private decisions: DecisionLog[] = [];

  async saveDecision(decision: DecisionLog): Promise<void> {
    this.decisions.push(decision);

    // Keep only recent decisions
    if (this.decisions.length > 5000) {
      this.decisions = this.decisions.slice(-5000);
    }
  }

  async loadDecisions(contextId?: ContextId, limit = 100): Promise<DecisionLog[]> {
    let filtered = [...this.decisions];

    if (contextId) {
      filtered = filtered.filter((d) => d.contextId === contextId);
    }

    return filtered.slice(-limit);
  }

  async updateOutcome(decisionId: DecisionId, outcome: DecisionOutcome): Promise<void> {
    const decision = this.decisions.find((d) => d.id === decisionId);
    if (decision) {
      decision.outcome = outcome;
    }
  }

  async getDecisionById(decisionId: DecisionId): Promise<DecisionLog | null> {
    return this.decisions.find((d) => d.id === decisionId) || null;
  }

  async queryByConfidence(level: ConfidenceLevel, limit = 50): Promise<DecisionLog[]> {
    return this.decisions.filter((d) => d.confidenceLevel === level).slice(-limit);
  }

  async queryByType(type: DecisionType, limit = 50): Promise<DecisionLog[]> {
    return this.decisions.filter((d) => d.type === type).slice(-limit);
  }

  clear(): void {
    this.decisions = [];
  }

  getAllDecisions(): DecisionLog[] {
    return [...this.decisions];
  }
}

/**
 * Main interpretability logger for tracking agent decisions.
 */
export class InterpretabilityLogger {
  private config: InterpretabilityConfig;
  private storage: DecisionStorage;
  private recentDecisions: DecisionLog[] = [];

  constructor(config: Partial<InterpretabilityConfig> = {}) {
    this.config = { ...DEFAULT_INTERPRETABILITY_CONFIG, ...config };
    this.storage = config.storage || new InMemoryDecisionStorage();
  }

  /**
   * Log a decision with full transparency context.
   */
  async logDecision(
    decision: Omit<DecisionLog, "id" | "timestamp" | "confidenceLevel">,
  ): Promise<DecisionId> {
    if (!this.config.enabled) {
      return "disabled";
    }

    // Skip if below confidence threshold
    if (decision.confidence < this.config.minConfidenceToLog) {
      return "skipped_low_confidence";
    }

    const id = `decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const confidenceLevel = this.categorizeConfidence(decision.confidence);

    const fullDecision: DecisionLog = {
      id,
      timestamp: Date.now(),
      confidenceLevel,
      ...decision,
    };

    // Save to storage
    await this.storage.saveDecision(fullDecision);

    // Keep in memory for quick access
    this.recentDecisions.push(fullDecision);
    if (this.recentDecisions.length > this.config.maxDecisionsInMemory) {
      this.recentDecisions.shift();
    }

    if (this.config.verbose) {
      this.logToConsole(fullDecision);
    }

    return id;
  }

  /**
   * Log a tool selection with detailed rationale.
   */
  async logToolSelection(
    rationale: ToolSelectionRationale,
    contextId?: ContextId,
    metadata?: Record<string, unknown>,
  ): Promise<DecisionId> {
    const influencingFactors: InfluencingFactor[] = [];

    // Add rejected tools as influencing factors
    if (rationale.rejectedTools) {
      rationale.rejectedTools.forEach((rejected) => {
        influencingFactors.push({
          name: `rejected_${rejected.tool}`,
          weight: 0.3,
          description: rejected.reason,
        });
      });
    }

    return this.logDecision({
      type: "tool_selection",
      contextId,
      description: `Selected tool: ${rationale.selectedTool}`,
      choice: rationale.selectedTool,
      alternatives: rationale.rejectedTools?.map((r) => r.tool),
      rationale: rationale.reason,
      confidence: rationale.confidence,
      influencingFactors,
      metadata: this.config.includeMetadata
        ? {
            expectedOutcome: rationale.expectedOutcome,
            parameterRationale: rationale.parameterRationale,
            ...metadata,
          }
        : undefined,
    });
  }

  /**
   * Update a decision with its outcome after execution.
   */
  async recordOutcome(decisionId: DecisionId, outcome: DecisionOutcome): Promise<void> {
    await this.storage.updateOutcome(decisionId, outcome);

    const decision = this.recentDecisions.find((d) => d.id === decisionId);
    if (decision) {
      decision.outcome = outcome;
    }

    if (this.config.verbose && !outcome.success) {
      console.log(`[InterpretabilityLogger] Decision ${decisionId} failed: ${outcome.error}`);
    }
  }

  /**
   * Get recent decisions for analysis.
   */
  async getRecentDecisions(contextId?: ContextId, limit = 50): Promise<DecisionLog[]> {
    return this.storage.loadDecisions(contextId, limit);
  }

  /**
   * Get decisions by confidence level (useful for finding uncertain decisions).
   */
  async getDecisionsByConfidence(level: ConfidenceLevel, limit = 50): Promise<DecisionLog[]> {
    return this.storage.queryByConfidence(level, limit);
  }

  /**
   * Get decisions by type.
   */
  async getDecisionsByType(type: DecisionType, limit = 50): Promise<DecisionLog[]> {
    return this.storage.queryByType(type, limit);
  }

  /**
   * Analyze decision patterns to identify improvement opportunities.
   */
  async analyzeDecisionPatterns(): Promise<DecisionAnalysis> {
    const allDecisions = await this.storage.loadDecisions(undefined, 500);

    const totalDecisions = allDecisions.length;
    const lowConfidenceCount = allDecisions.filter((d) => d.confidenceLevel === "low").length;
    const failedDecisions = allDecisions.filter((d) => d.outcome && !d.outcome.success).length;

    const avgConfidence =
      totalDecisions > 0
        ? allDecisions.reduce((sum, d) => sum + d.confidence, 0) / totalDecisions
        : 0;

    const successRate =
      totalDecisions > 0
        ? allDecisions.filter((d) => d.outcome?.success).length / totalDecisions
        : 0;

    const typeDistribution: Record<DecisionType, number> = {} as Record<DecisionType, number>;
    allDecisions.forEach((d) => {
      typeDistribution[d.type] = (typeDistribution[d.type] || 0) + 1;
    });

    return {
      totalDecisions,
      lowConfidenceCount,
      lowConfidenceRate: totalDecisions > 0 ? lowConfidenceCount / totalDecisions : 0,
      failedDecisions,
      failureRate: totalDecisions > 0 ? failedDecisions / totalDecisions : 0,
      avgConfidence,
      successRate,
      typeDistribution,
      recommendations: this.generateRecommendations(allDecisions),
    };
  }

  /**
   * Categorize confidence score into level.
   */
  private categorizeConfidence(confidence: number): ConfidenceLevel {
    if (confidence >= 0.8) {
      return "high";
    }
    if (confidence >= 0.5) {
      return "medium";
    }
    return "low";
  }

  /**
   * Log decision to console (verbose mode).
   */
  private logToConsole(decision: DecisionLog): void {
    const emoji =
      decision.confidenceLevel === "high"
        ? "✅"
        : decision.confidenceLevel === "medium"
          ? "⚠️"
          : "🔍";
    console.log(
      `${emoji} [Decision] ${decision.type}: ${decision.choice} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`,
    );
    console.log(`  Rationale: ${decision.rationale}`);
    if (decision.alternatives?.length) {
      console.log(`  Alternatives: ${decision.alternatives.join(", ")}`);
    }
  }

  /**
   * Generate recommendations based on decision patterns.
   */
  private generateRecommendations(decisions: DecisionLog[]): string[] {
    const recommendations: string[] = [];

    const lowConfidenceRate =
      decisions.filter((d) => d.confidenceLevel === "low").length / decisions.length;
    if (lowConfidenceRate > 0.3) {
      recommendations.push(
        "High rate of low-confidence decisions. Consider improving prompts or adding more context.",
      );
    }

    const failedDecisions = decisions.filter((d) => d.outcome && !d.outcome.success);
    if (failedDecisions.length > decisions.length * 0.2) {
      recommendations.push(
        "High failure rate detected. Review failed decisions for common patterns.",
      );
    }

    const toolSelections = decisions.filter((d) => d.type === "tool_selection");
    if (toolSelections.length > 0) {
      const avgToolConfidence =
        toolSelections.reduce((sum, d) => sum + d.confidence, 0) / toolSelections.length;

      if (avgToolConfidence < 0.6) {
        recommendations.push(
          "Tool selection confidence is low. Consider providing tool usage examples or documentation.",
        );
      }
    }

    return recommendations;
  }
}

/**
 * Analysis of decision patterns.
 */
export interface DecisionAnalysis {
  totalDecisions: number;
  lowConfidenceCount: number;
  lowConfidenceRate: number;
  failedDecisions: number;
  failureRate: number;
  avgConfidence: number;
  successRate: number;
  typeDistribution: Record<DecisionType, number>;
  recommendations: string[];
}

/**
 * Helper to create a tool selection rationale.
 */
export function createToolRationale(
  selectedTool: string,
  reason: string,
  confidence: number,
  expectedOutcome: string,
  rejectedTools?: Array<{ tool: string; reason: string }>,
  parameterRationale?: Record<string, string>,
): ToolSelectionRationale {
  return {
    selectedTool,
    reason,
    confidence,
    expectedOutcome,
    rejectedTools,
    parameterRationale,
  };
}

/**
 * Helper to wrap an operation with decision logging and outcome recording.
 */
export async function withDecisionLogging<T>(
  logger: InterpretabilityLogger,
  decision: Omit<DecisionLog, "id" | "timestamp" | "confidenceLevel">,
  operation: () => Promise<T>,
): Promise<{ result: T; decisionId: DecisionId }> {
  const startTime = Date.now();
  const decisionId = await logger.logDecision(decision);

  try {
    const result = await operation();

    await logger.recordOutcome(decisionId, {
      success: true,
      executionTimeMs: Date.now() - startTime,
      result,
    });

    return { result, decisionId };
  } catch (error) {
    await logger.recordOutcome(decisionId, {
      success: false,
      executionTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
