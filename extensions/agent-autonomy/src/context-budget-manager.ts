/**
 * Context Window Budget Manager
 *
 * Intelligently distributes the available context window across multiple
 * content sources: system prompt, memory retrieval, tool results, and
 * conversation history. Uses priority-based allocation with dynamic
 * rebalancing to maximize information density and prevent context overflow.
 *
 * Key concepts:
 * - Each content source is assigned a "slot" with min/max token budgets
 * - Slots have priorities (critical > high > normal > low)
 * - Unused budget from lower-priority slots flows up to higher-priority ones
 * - Dynamic rebalancing adjusts allocations based on actual usage patterns
 *
 * Benefits:
 * - Prevents context overflow (a common agent failure mode)
 * - Ensures the most relevant information always fits
 * - Reduces token waste from oversized low-value content
 * - Provides visibility into context window utilization
 *
 * Source: Inspired by "Leave No Context Behind" (arXiv:2404.07143) and
 * practical context management patterns in production LLM agents.
 */

/** Priority levels for budget allocation (higher = more important). */
export type SlotPriority = "critical" | "high" | "normal" | "low";

/** Numeric priority values for sorting. */
const PRIORITY_VALUES: Record<SlotPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/** Configuration for a single content slot. */
export interface BudgetSlot {
  /** Unique identifier for this slot (e.g., "system_prompt", "memory", "tools"). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Priority level for allocation. */
  priority: SlotPriority;
  /** Minimum guaranteed tokens (will not be reduced below this). */
  minTokens: number;
  /** Maximum tokens this slot can use (soft cap, can overflow if budget allows). */
  maxTokens: number;
  /** Current token usage (updated as content is added). */
  currentTokens: number;
  /** Whether this slot can donate unused budget to others. */
  shareable: boolean;
}

/** Overall budget configuration. */
export interface BudgetConfig {
  /** Total available context window tokens. */
  totalTokens: number;
  /** Reserve tokens for model output generation. */
  outputReserve: number;
  /** Slots to manage. */
  slots: BudgetSlot[];
  /** Token estimation method. */
  estimationMethod: "chars_div_4" | "words" | "custom";
  /** Custom token estimator function (for estimationMethod: "custom"). */
  customEstimator?: (text: string) => number;
}

/** Result of a budget allocation request. */
export interface AllocationResult {
  /** Whether the content fits within the allocated budget. */
  fits: boolean;
  /** Allocated token count for this slot. */
  allocatedTokens: number;
  /** Tokens that need to be trimmed (0 if fits). */
  overflowTokens: number;
  /** Suggested action when content doesn't fit. */
  suggestion?: "truncate" | "summarize" | "defer" | "drop";
  /** Remaining budget across all slots after this allocation. */
  remainingBudget: number;
}

/** Snapshot of current budget utilization. */
export interface BudgetSnapshot {
  /** Total available tokens (minus output reserve). */
  usableBudget: number;
  /** Total tokens currently allocated. */
  totalUsed: number;
  /** Remaining tokens. */
  remaining: number;
  /** Utilization ratio (0-1). */
  utilization: number;
  /** Per-slot utilization details. */
  slots: Array<{
    id: string;
    label: string;
    priority: SlotPriority;
    allocated: number;
    max: number;
    utilization: number;
  }>;
  /** Whether budget is overcommitted. */
  overcommitted: boolean;
}

/** Record of a budget rebalance event. */
export interface RebalanceEvent {
  timestamp: number;
  /** Slot that donated budget. */
  donorSlotId: string;
  /** Slot that received budget. */
  recipientSlotId: string;
  /** Tokens transferred. */
  tokensTransferred: number;
  /** Reason for rebalance. */
  reason: string;
}

/** Default token estimation: ~4 characters per token (rough heuristic). */
function estimateTokensCharDiv4(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Word-based token estimation: ~0.75 tokens per word for English. */
function estimateTokensWords(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.33);
}

/** Common default budget slots for an agent system. */
export const DEFAULT_SLOTS: BudgetSlot[] = [
  {
    id: "system_prompt",
    label: "System Prompt",
    priority: "critical",
    minTokens: 500,
    maxTokens: 4000,
    currentTokens: 0,
    shareable: false,
  },
  {
    id: "workspace_context",
    label: "Workspace Context",
    priority: "high",
    minTokens: 200,
    maxTokens: 8000,
    currentTokens: 0,
    shareable: true,
  },
  {
    id: "memory",
    label: "Memory Retrieval",
    priority: "normal",
    minTokens: 100,
    maxTokens: 4000,
    currentTokens: 0,
    shareable: true,
  },
  {
    id: "tool_results",
    label: "Tool Results",
    priority: "high",
    minTokens: 200,
    maxTokens: 16000,
    currentTokens: 0,
    shareable: true,
  },
  {
    id: "conversation",
    label: "Conversation History",
    priority: "normal",
    minTokens: 500,
    maxTokens: 32000,
    currentTokens: 0,
    shareable: true,
  },
  {
    id: "skills",
    label: "Skill Instructions",
    priority: "low",
    minTokens: 0,
    maxTokens: 4000,
    currentTokens: 0,
    shareable: true,
  },
];

/**
 * Context Window Budget Manager
 *
 * Manages token allocation across content sources to prevent
 * context overflow and maximize information density.
 */
export class ContextBudgetManager {
  private config: BudgetConfig;
  private rebalanceHistory: RebalanceEvent[] = [];
  private estimateTokens: (text: string) => number;

  constructor(config: Partial<BudgetConfig> & { totalTokens: number }) {
    this.config = {
      totalTokens: config.totalTokens,
      outputReserve: config.outputReserve ?? 4096,
      slots: config.slots
        ? config.slots.map((s) => ({ ...s }))
        : DEFAULT_SLOTS.map((s) => ({ ...s })),
      estimationMethod: config.estimationMethod ?? "chars_div_4",
      customEstimator: config.customEstimator,
    };

    // Set up token estimator
    if (config.estimationMethod === "custom" && config.customEstimator) {
      this.estimateTokens = config.customEstimator;
    } else if (config.estimationMethod === "words") {
      this.estimateTokens = estimateTokensWords;
    } else {
      this.estimateTokens = estimateTokensCharDiv4;
    }

    this.validateConfig();
  }

  /**
   * Get the usable budget (total minus output reserve).
   */
  get usableBudget(): number {
    return this.config.totalTokens - this.config.outputReserve;
  }

  /**
   * Get the total tokens currently used across all slots.
   */
  get totalUsed(): number {
    return this.config.slots.reduce((sum, slot) => sum + slot.currentTokens, 0);
  }

  /**
   * Get the remaining available tokens.
   */
  get remaining(): number {
    return Math.max(0, this.usableBudget - this.totalUsed);
  }

  /**
   * Estimate token count for a piece of text.
   */
  estimate(text: string): number {
    return this.estimateTokens(text);
  }

  /**
   * Request allocation for a content slot.
   * Returns whether the content fits and how to handle overflow.
   */
  requestAllocation(slotId: string, content: string): AllocationResult {
    this.findSlot(slotId); // validate slot exists
    const tokenCount = this.estimateTokens(content);
    return this.requestAllocationByTokens(slotId, tokenCount);
  }

  /**
   * Request allocation by token count (when content is already estimated).
   */
  requestAllocationByTokens(slotId: string, tokenCount: number): AllocationResult {
    const slot = this.findSlot(slotId);
    const available = this.getAvailableForSlot(slot);

    if (tokenCount <= available) {
      return {
        fits: true,
        allocatedTokens: tokenCount,
        overflowTokens: 0,
        remainingBudget: this.remaining - tokenCount + slot.currentTokens,
      };
    }

    // Content exceeds available budget for this slot
    const overflow = tokenCount - available;

    // Try to borrow from lower-priority shareable slots
    const borrowable = this.calculateBorrowable(slot.priority);
    if (tokenCount <= available + borrowable) {
      return {
        fits: true,
        allocatedTokens: tokenCount,
        overflowTokens: 0,
        suggestion: undefined,
        remainingBudget: this.remaining - tokenCount + slot.currentTokens,
      };
    }

    // Determine suggestion based on overflow size
    let suggestion: "truncate" | "summarize" | "defer" | "drop";
    const overflowRatio = overflow / tokenCount;

    if (overflowRatio < 0.2) {
      suggestion = "truncate";
    } else if (overflowRatio < 0.5) {
      suggestion = "summarize";
    } else if (slot.priority === "low") {
      suggestion = "drop";
    } else {
      suggestion = "defer";
    }

    return {
      fits: false,
      allocatedTokens: available + borrowable,
      overflowTokens: overflow - borrowable,
      suggestion,
      remainingBudget: 0,
    };
  }

  /**
   * Record actual token usage for a slot.
   */
  recordUsage(slotId: string, content: string): void {
    const slot = this.findSlot(slotId);
    slot.currentTokens = this.estimateTokens(content);
  }

  /**
   * Record actual token usage by count.
   */
  recordUsageByTokens(slotId: string, tokenCount: number): void {
    const slot = this.findSlot(slotId);
    slot.currentTokens = tokenCount;
  }

  /**
   * Reset usage for a specific slot.
   */
  resetSlot(slotId: string): void {
    const slot = this.findSlot(slotId);
    slot.currentTokens = 0;
  }

  /**
   * Reset all slot usage.
   */
  resetAll(): void {
    for (const slot of this.config.slots) {
      slot.currentTokens = 0;
    }
  }

  /**
   * Get a snapshot of current budget utilization.
   */
  getSnapshot(): BudgetSnapshot {
    const used = this.totalUsed;
    const usable = this.usableBudget;

    return {
      usableBudget: usable,
      totalUsed: used,
      remaining: Math.max(0, usable - used),
      utilization: usable > 0 ? Math.min(1, used / usable) : 0,
      slots: this.config.slots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        priority: slot.priority,
        allocated: slot.currentTokens,
        max: slot.maxTokens,
        utilization: slot.maxTokens > 0 ? Math.min(1, slot.currentTokens / slot.maxTokens) : 0,
      })),
      overcommitted: used > usable,
    };
  }

  /**
   * Rebalance budget by reclaiming unused allocations from shareable slots
   * and redistributing to higher-priority slots that need more space.
   */
  rebalance(): RebalanceEvent[] {
    const events: RebalanceEvent[] = [];

    // Find slots that have excess capacity (using less than min)
    const donors = this.config.slots
      .filter((s) => s.shareable && s.currentTokens < s.maxTokens)
      .toSorted((a, b) => PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority]);

    // Find slots that are near or at capacity
    const recipients = this.config.slots
      .filter((s) => s.currentTokens >= s.maxTokens * 0.9)
      .toSorted((a, b) => PRIORITY_VALUES[b.priority] - PRIORITY_VALUES[a.priority]);

    for (const recipient of recipients) {
      if (recipient.currentTokens <= recipient.maxTokens) {
        continue;
      }

      const needed = recipient.currentTokens - recipient.maxTokens;
      let transferred = 0;

      for (const donor of donors) {
        if (transferred >= needed) {
          break;
        }
        if (donor.id === recipient.id) {
          continue;
        }

        const donatable = Math.max(
          0,
          donor.maxTokens - Math.max(donor.currentTokens, donor.minTokens),
        );
        if (donatable <= 0) {
          continue;
        }

        const amount = Math.min(donatable, needed - transferred);
        donor.maxTokens -= amount;
        recipient.maxTokens += amount;
        transferred += amount;

        const event: RebalanceEvent = {
          timestamp: Date.now(),
          donorSlotId: donor.id,
          recipientSlotId: recipient.id,
          tokensTransferred: amount,
          reason: `Slot "${recipient.label}" at ${Math.round((recipient.currentTokens / (recipient.maxTokens - amount)) * 100)}% capacity`,
        };
        events.push(event);
      }
    }

    this.rebalanceHistory.push(...events);

    // Keep only last 100 events
    if (this.rebalanceHistory.length > 100) {
      this.rebalanceHistory = this.rebalanceHistory.slice(-100);
    }

    return events;
  }

  /**
   * Get a slot by ID.
   */
  getSlot(slotId: string): BudgetSlot | undefined {
    return this.config.slots.find((s) => s.id === slotId);
  }

  /**
   * Add a new slot dynamically.
   */
  addSlot(slot: BudgetSlot): void {
    if (this.config.slots.some((s) => s.id === slot.id)) {
      throw new Error(`Slot "${slot.id}" already exists`);
    }
    this.config.slots.push({ ...slot });
  }

  /**
   * Remove a slot by ID.
   */
  removeSlot(slotId: string): boolean {
    const index = this.config.slots.findIndex((s) => s.id === slotId);
    if (index >= 0) {
      this.config.slots.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get rebalance history.
   */
  getRebalanceHistory(): RebalanceEvent[] {
    return [...this.rebalanceHistory];
  }

  /**
   * Trim content to fit within a token budget.
   * Truncates from the end, preserving the beginning of the content.
   */
  trimToFit(
    content: string,
    maxTokens: number,
  ): { trimmed: string; tokenCount: number; wasTrimmed: boolean } {
    const tokens = this.estimateTokens(content);
    if (tokens <= maxTokens) {
      return { trimmed: content, tokenCount: tokens, wasTrimmed: false };
    }

    // Estimate character count for target tokens
    // Use the inverse of our estimation method
    const targetChars = maxTokens * 4; // conservative for chars_div_4
    const truncated = content.slice(0, targetChars);

    // Fine-tune: trim to last complete line
    const lastNewline = truncated.lastIndexOf("\n");
    const cleanTruncated =
      lastNewline > targetChars * 0.8 ? truncated.slice(0, lastNewline) : truncated;

    const suffix = "\n\n[... content truncated to fit context budget ...]";
    const result = cleanTruncated + suffix;

    return {
      trimmed: result,
      tokenCount: this.estimateTokens(result),
      wasTrimmed: true,
    };
  }

  /**
   * Generate a human-readable budget report.
   */
  formatReport(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [
      `Context Budget: ${snapshot.totalUsed.toLocaleString()} / ${snapshot.usableBudget.toLocaleString()} tokens (${Math.round(snapshot.utilization * 100)}% used)`,
      "",
    ];

    const maxLabelLen = Math.max(...snapshot.slots.map((s) => s.label.length));

    for (const slot of snapshot.slots) {
      const bar = this.renderBar(slot.utilization, 20);
      const label = slot.label.padEnd(maxLabelLen);
      const usage = slot.allocated.toLocaleString().padStart(6);
      const max = slot.max.toLocaleString().padStart(6);
      lines.push(`  ${label}  ${bar}  ${usage} / ${max}  [${slot.priority}]`);
    }

    if (snapshot.overcommitted) {
      lines.push("");
      lines.push("⚠️  Budget overcommitted! Consider trimming or deferring content.");
    }

    return lines.join("\n");
  }

  // --- Private helpers ---

  private findSlot(slotId: string): BudgetSlot {
    const slot = this.config.slots.find((s) => s.id === slotId);
    if (!slot) {
      throw new Error(`Unknown budget slot: "${slotId}"`);
    }
    return slot;
  }

  private getAvailableForSlot(slot: BudgetSlot): number {
    // Available is the smaller of: slot max or remaining global budget
    const slotAvailable = slot.maxTokens - slot.currentTokens;
    const globalAvailable = this.remaining;
    return Math.max(0, Math.min(slotAvailable, globalAvailable + slot.currentTokens));
  }

  private calculateBorrowable(recipientPriority: SlotPriority): number {
    const recipientValue = PRIORITY_VALUES[recipientPriority];
    let borrowable = 0;

    for (const slot of this.config.slots) {
      if (!slot.shareable) {
        continue;
      }
      if (PRIORITY_VALUES[slot.priority] >= recipientValue) {
        continue;
      }

      // Can borrow unused portion above minimum
      const unused = Math.max(0, slot.maxTokens - Math.max(slot.currentTokens, slot.minTokens));
      borrowable += unused;
    }

    return borrowable;
  }

  private validateConfig(): void {
    if (this.config.totalTokens <= 0) {
      throw new Error("totalTokens must be positive");
    }
    if (this.config.outputReserve < 0) {
      throw new Error("outputReserve must be non-negative");
    }
    if (this.config.outputReserve >= this.config.totalTokens) {
      throw new Error("outputReserve must be less than totalTokens");
    }

    const totalMin = this.config.slots.reduce((sum, s) => sum + s.minTokens, 0);
    if (totalMin > this.usableBudget) {
      throw new Error(
        `Total minimum slot requirements (${totalMin}) exceed usable budget (${this.usableBudget})`,
      );
    }
  }

  private renderBar(ratio: number, width: number): string {
    const filled = Math.round(ratio * width);
    const empty = width - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
  }
}

/**
 * Create a budget manager pre-configured for common model context sizes.
 */
export function createBudgetManager(
  model: "small" | "medium" | "large" | "xlarge",
  overrides?: Partial<BudgetConfig>,
): ContextBudgetManager {
  const contextSizes: Record<string, number> = {
    small: 8192,
    medium: 32768,
    large: 128000,
    xlarge: 200000,
  };

  const totalTokens = contextSizes[model] ?? 128000;

  return new ContextBudgetManager({
    totalTokens,
    ...overrides,
  });
}
