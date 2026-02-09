/** Shared type definitions for the agent-autonomy extension. */

export type MemoryPriority = "low" | "normal" | "high" | "critical";

export type MemoryWriteParams = {
  path: string;
  content: string;
  append?: boolean;
  section?: string;
  priority?: MemoryPriority;
  tags?: string[];
};

export type MemoryUpdateParams = {
  path: string;
  fromLine: number;
  toLine: number;
  newContent: string;
};

export type MemoryForgetParams = {
  path: string;
  fromLine?: number;
  toLine?: number;
  reason?: string;
};

export type ValidationResult = {
  valid: boolean;
  confidence: number;
  issues: string[];
  suggestedAction?: "retry_same" | "modify_params" | "alternative_tool" | "escalate" | "accept";
};

export type ToolErrorCategory =
  | "transient"
  | "resource"
  | "semantic"
  | "permanent"
  | "context_limit";

export type RetryStrategy = "retry_same" | "modify_params" | "alternative_tool" | "escalate";

export type ErrorClassification = {
  category: ToolErrorCategory;
  suggestedStrategy: RetryStrategy;
  isRetryable: boolean;
  confidence: number;
  detail?: string;
};

export type CompactionSection = "decisions" | "openQuestions" | "todos" | "context";

export type CompactedSummary = {
  sections: Record<CompactionSection, string[]>;
  raw?: string;
};

export type JitContextEntry = {
  source: string;
  snippet: string;
  score: number;
};

export type MemoryDecayEntry = {
  path: string;
  lastAccessed: number;
  accessCount: number;
  priority: MemoryPriority;
  decayScore: number;
};

export type ToolExecutionRecord = {
  toolName: string;
  success: boolean;
  executionTimeMs: number;
  errorCategory?: ToolErrorCategory;
  timestamp: number;
};

export type ToolAnalytics = {
  toolName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  averageExecutionTimeMs: number;
  commonErrors: Array<{ category: ToolErrorCategory; count: number }>;
  lastUsed: number;
};

export type ToolAnalyticsSnapshot = {
  version: string;
  generatedAt: number;
  tools: Record<string, ToolAnalytics>;
};
