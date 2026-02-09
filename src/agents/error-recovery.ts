/**
 * error-recovery.ts
 * 
 * Structured error recovery system for agent tasks with exponential backoff,
 * circuit breakers, and error classification to improve autonomous resilience.
 */

export interface ErrorRecoveryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
}

export const DEFAULT_CONFIG: ErrorRecoveryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60000,
};

export enum ErrorType {
  TRANSIENT = 'transient', // Retryable (network, rate limit, timeout)
  PERMANENT = 'permanent',  // Non-retryable (auth error, not found, validation)
  UNKNOWN = 'unknown',      // Unclear - default to transient with caution
}

export interface ErrorContext {
  type: ErrorType;
  message: string;
  originalError: unknown;
  attemptNumber: number;
  totalAttempts: number;
  nextRetryDelayMs?: number;
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number,
    private resetMs: number
  ) {}

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  isOpen(): boolean {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetMs) {
        this.state = 'half-open';
        this.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Classify an error to determine if it's retryable
 */
export function classifyError(error: unknown): ErrorType {
  if (!error) return ErrorType.UNKNOWN;

  const errorMsg = error instanceof Error ? error.message : String(error);
  const lowerMsg = errorMsg.toLowerCase();

  // Transient errors (retryable)
  if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enetunreach') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('503') ||
    lowerMsg.includes('504') ||
    lowerMsg.includes('temporary') ||
    lowerMsg.includes('throttle')
  ) {
    return ErrorType.TRANSIENT;
  }

  // Permanent errors (non-retryable)
  if (
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden') ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('invalid') ||
    lowerMsg.includes('400') ||
    lowerMsg.includes('401') ||
    lowerMsg.includes('403') ||
    lowerMsg.includes('404') ||
    lowerMsg.includes('validation')
  ) {
    return ErrorType.PERMANENT;
  }

  return ErrorType.UNKNOWN;
}

/**
 * Calculate delay for exponential backoff
 */
function calculateBackoffDelay(
  attemptNumber: number,
  config: ErrorRecoveryConfig
): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber),
    config.maxDelayMs
  );
  
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

/**
 * Execute an operation with automatic retry logic, exponential backoff,
 * and circuit breaker protection
 */
export async function withErrorRecovery<T>(
  operation: () => Promise<T>,
  options: Partial<ErrorRecoveryConfig> = {},
  operationName = 'operation'
): Promise<T> {
  const config = { ...DEFAULT_CONFIG, ...options };
  const circuitBreaker = new CircuitBreaker(
    config.circuitBreakerThreshold,
    config.circuitBreakerResetMs
  );

  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    // Check circuit breaker
    if (circuitBreaker.isOpen()) {
      const error = new Error(
        `Circuit breaker open for ${operationName} after ${config.circuitBreakerThreshold} failures`
      );
      throw error;
    }

    try {
      const result = await operation();
      circuitBreaker.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      const errorType = classifyError(error);

      const context: ErrorContext = {
        type: errorType,
        message: error instanceof Error ? error.message : String(error),
        originalError: error,
        attemptNumber: attempt + 1,
        totalAttempts: config.maxRetries,
      };

      // Don't retry permanent errors
      if (errorType === ErrorType.PERMANENT) {
        circuitBreaker.recordFailure();
        throw new Error(
          `Permanent error in ${operationName}: ${context.message}`
        );
      }

      // Last attempt - don't wait, just throw
      if (attempt === config.maxRetries - 1) {
        circuitBreaker.recordFailure();
        throw new Error(
          `Operation ${operationName} failed after ${config.maxRetries} attempts: ${context.message}`
        );
      }

      // Calculate backoff and wait
      const delay = calculateBackoffDelay(attempt, config);
      context.nextRetryDelayMs = delay;

      console.warn(
        `[ErrorRecovery] ${operationName} attempt ${attempt + 1}/${config.maxRetries} failed (${errorType}): ${context.message}. Retrying in ${delay}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  circuitBreaker.recordFailure();
  throw new Error(
    `Operation ${operationName} exhausted all retries: ${lastError}`
  );
}

/**
 * Create a wrapped version of an async function with built-in error recovery
 */
export function createResilientOperation<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: Partial<ErrorRecoveryConfig> = {},
  name?: string
): T {
  const operationName = name || fn.name || 'anonymous';
  
  return ((...args: Parameters<T>) => {
    return withErrorRecovery(
      () => fn(...args),
      config,
      operationName
    );
  }) as T;
}
