/**
 * Reflexion-Based Self-Correction with Failure Pattern Learning
 *
 * Enables agents to learn from past failures by maintaining a structured
 * failure log and automatically applying corrections when similar patterns
 * are detected. This creates a self-improving feedback loop where each
 * failure becomes a learning opportunity.
 *
 * Benefits:
 * - Automatic error recovery without manual intervention
 * - Continuous self-improvement over time
 * - Reduced repeated errors through pattern recognition
 * - Building institutional knowledge of debugging strategies
 *
 * Source: Reflexion: Language Agents with Verbal Reinforcement Learning
 * https://arxiv.org/abs/2303.11366
 */

export interface FailurePattern {
  /** Unique identifier for this pattern */
  id: string;
  /** Pattern name/description */
  name: string;
  /** Error message pattern (regex or substring) */
  errorPattern: string | RegExp;
  /** Tool or context where failure occurred */
  context?: string;
  /** Correction strategy to apply */
  correction: CorrectionStrategy;
  /** Number of times this pattern has been encountered */
  occurrences: number;
  /** Number of successful recoveries using this correction */
  successfulRecoveries: number;
  /** First seen timestamp */
  firstSeen: number;
  /** Last seen timestamp */
  lastSeen: number;
  /** Confidence score (0-1) based on success rate */
  confidence: number;
}

export interface CorrectionStrategy {
  /** Type of correction to apply */
  type: "retry" | "parameter_adjust" | "alternative_approach" | "skip" | "custom";
  /** Description of the correction */
  description: string;
  /** Specific parameters for the correction */
  params?: Record<string, unknown>;
  /** Custom correction function (for type "custom") */
  apply?: (error: Error, context: unknown) => Promise<unknown>;
}

export interface FailureRecord {
  /** Timestamp of the failure */
  timestamp: number;
  /** Error message */
  errorMessage: string;
  /** Stack trace if available */
  stackTrace?: string;
  /** Tool or operation that failed */
  operation: string;
  /** Context data (sanitized) */
  context?: Record<string, unknown>;
  /** Matched pattern ID (if any) */
  matchedPatternId?: string;
  /** Whether correction was attempted */
  correctionAttempted: boolean;
  /** Whether correction was successful */
  correctionSuccessful?: boolean;
}

export interface ReflexionConfig {
  /** Enable automatic pattern detection */
  autoDetect: boolean;
  /** Minimum occurrences before creating a pattern */
  minOccurrencesForPattern: number;
  /** Minimum confidence to auto-apply correction (0-1) */
  minConfidenceForAutoCorrection: number;
  /** Maximum patterns to store */
  maxPatterns: number;
  /** Storage for persistence */
  storage?: FailureStorage;
  /** Enable verbose logging */
  verbose: boolean;
}

export interface FailureStorage {
  savePattern(pattern: FailurePattern): Promise<void>;
  loadPatterns(): Promise<FailurePattern[]>;
  saveRecord(record: FailureRecord): Promise<void>;
  loadRecords(limit?: number): Promise<FailureRecord[]>;
}

export const DEFAULT_REFLEXION_CONFIG: ReflexionConfig = {
  autoDetect: true,
  minOccurrencesForPattern: 3,
  minConfidenceForAutoCorrection: 0.7,
  maxPatterns: 100,
  verbose: false,
};

/**
 * In-memory failure storage for development/testing.
 * Production should use file-based storage (e.g., memory/failure-patterns.json)
 */
export class InMemoryFailureStorage implements FailureStorage {
  private patterns: FailurePattern[] = [];
  private records: FailureRecord[] = [];

  async savePattern(pattern: FailurePattern): Promise<void> {
    const index = this.patterns.findIndex((p) => p.id === pattern.id);
    if (index >= 0) {
      this.patterns[index] = pattern;
    } else {
      this.patterns.push(pattern);
    }
  }

  async loadPatterns(): Promise<FailurePattern[]> {
    return [...this.patterns];
  }

  async saveRecord(record: FailureRecord): Promise<void> {
    this.records.push(record);
    // Keep only last 1000 records
    if (this.records.length > 1000) {
      this.records = this.records.slice(-1000);
    }
  }

  async loadRecords(limit = 100): Promise<FailureRecord[]> {
    return this.records.slice(-limit);
  }

  clear(): void {
    this.patterns = [];
    this.records = [];
  }
}

/**
 * Self-correcting agent that learns from failures and applies corrections.
 */
export class ReflexionSelfCorrector {
  private patterns: FailurePattern[] = [];
  private config: ReflexionConfig;
  private storage: FailureStorage;

  constructor(config: Partial<ReflexionConfig> = {}) {
    this.config = { ...DEFAULT_REFLEXION_CONFIG, ...config };
    this.storage = config.storage || new InMemoryFailureStorage();
  }

  /**
   * Initialize by loading existing patterns from storage.
   */
  async initialize(): Promise<void> {
    this.patterns = await this.storage.loadPatterns();

    if (this.config.verbose) {
      console.log(`[ReflexionSelfCorrector] Loaded ${this.patterns.length} failure patterns`);
    }
  }

  /**
   * Handle a failure and attempt correction if pattern matches.
   */
  async handleFailure(
    error: Error,
    operation: string,
    context?: Record<string, unknown>,
  ): Promise<{ shouldRetry: boolean; correction?: CorrectionStrategy; pattern?: FailurePattern }> {
    // Record the failure
    const record: FailureRecord = {
      timestamp: Date.now(),
      errorMessage: error.message,
      stackTrace: error.stack,
      operation,
      context: this.sanitizeContext(context),
      correctionAttempted: false,
    };

    // Try to match against known patterns
    const matchedPattern = this.findMatchingPattern(error, operation);

    if (matchedPattern) {
      record.matchedPatternId = matchedPattern.id;

      // Update pattern statistics
      matchedPattern.occurrences++;
      matchedPattern.lastSeen = Date.now();
      await this.storage.savePattern(matchedPattern);

      // Check if we should auto-apply correction
      if (matchedPattern.confidence >= this.config.minConfidenceForAutoCorrection) {
        record.correctionAttempted = true;

        if (this.config.verbose) {
          console.log(
            `[ReflexionSelfCorrector] Applying correction for pattern: ${matchedPattern.name}`,
          );
        }

        await this.storage.saveRecord(record);

        return {
          shouldRetry: matchedPattern.correction.type !== "skip",
          correction: matchedPattern.correction,
          pattern: matchedPattern,
        };
      }

      // Pattern matched but confidence too low - still return pattern info
      await this.storage.saveRecord(record);
      return {
        shouldRetry: false,
        pattern: matchedPattern,
      };
    }

    await this.storage.saveRecord(record);

    // Auto-detect new patterns if enabled
    if (this.config.autoDetect) {
      await this.detectNewPattern(error, operation);
    }

    return { shouldRetry: false };
  }

  /**
   * Report successful correction to update pattern confidence.
   */
  async reportSuccess(patternId: string): Promise<void> {
    const pattern = this.patterns.find((p) => p.id === patternId);

    if (pattern) {
      pattern.successfulRecoveries++;
      pattern.confidence = pattern.successfulRecoveries / pattern.occurrences;
      await this.storage.savePattern(pattern);

      if (this.config.verbose) {
        console.log(
          `[ReflexionSelfCorrector] Pattern ${pattern.name} confidence updated to ${pattern.confidence.toFixed(2)}`,
        );
      }
    }
  }

  /**
   * Manually add a failure pattern.
   */
  async addPattern(
    pattern: Omit<FailurePattern, "id" | "firstSeen" | "lastSeen">,
  ): Promise<string> {
    const id = `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullPattern: FailurePattern = {
      id,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      ...pattern,
    };

    this.patterns.push(fullPattern);
    await this.storage.savePattern(fullPattern);

    if (this.config.verbose) {
      console.log(`[ReflexionSelfCorrector] Added new pattern: ${fullPattern.name}`);
    }

    return id;
  }

  /**
   * Get all patterns sorted by confidence.
   */
  getPatterns(): FailurePattern[] {
    return [...this.patterns].toSorted((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get recent failure records.
   */
  async getRecentFailures(limit = 50): Promise<FailureRecord[]> {
    return this.storage.loadRecords(limit);
  }

  /**
   * Find a matching pattern for the given error.
   */
  private findMatchingPattern(error: Error, operation: string): FailurePattern | undefined {
    return this.patterns.find((pattern) => {
      // Match error message
      const messageMatches =
        typeof pattern.errorPattern === "string"
          ? error.message.includes(pattern.errorPattern)
          : pattern.errorPattern.test(error.message);

      // Match context if specified
      const contextMatches = !pattern.context || pattern.context === operation;

      return messageMatches && contextMatches;
    });
  }

  /**
   * Automatically detect new patterns from repeated failures.
   */
  private async detectNewPattern(error: Error, operation: string): Promise<void> {
    const recentRecords = await this.storage.loadRecords(100);

    // Find similar errors
    const similarErrors = recentRecords.filter(
      (record) =>
        record.errorMessage === error.message &&
        record.operation === operation &&
        !record.matchedPatternId,
    );

    // Create pattern if threshold met
    if (similarErrors.length >= this.config.minOccurrencesForPattern) {
      // Check if we already have a pattern for this
      const existing = this.findMatchingPattern(error, operation);

      if (!existing) {
        await this.addPattern({
          name: `Auto-detected: ${error.message.substring(0, 50)}...`,
          errorPattern: error.message,
          context: operation,
          correction: {
            type: "retry",
            description: "Retry with exponential backoff",
          },
          occurrences: similarErrors.length,
          successfulRecoveries: 0,
          confidence: 0,
        });
      }
    }
  }

  /**
   * Sanitize context to remove sensitive data.
   */
  private sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!context) {
      return undefined;
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      // Skip sensitive-looking keys
      if (
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("key")
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

/**
 * Helper to wrap an async operation with reflexion-based self-correction.
 */
export async function withSelfCorrection<T>(
  corrector: ReflexionSelfCorrector,
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error | undefined;
  let attemptCount = 0;

  while (attemptCount <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      const result = await corrector.handleFailure(lastError, operation, context);

      if (result.shouldRetry && attemptCount < maxRetries) {
        attemptCount++;

        // Apply correction if available
        if (result.correction?.type === "parameter_adjust" && result.correction.params) {
          Object.assign(context || {}, result.correction.params);
        }

        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attemptCount) * 1000));

        continue;
      }

      throw lastError;
    }
  }

  throw lastError!;
}
