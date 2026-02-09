/**
 * Dual-Memory Architecture for Agent Autonomy
 *
 * Implements a clear separation between short-term (ephemeral, context-based)
 * and long-term (persistent, vector-store-based) memory patterns for autonomous agents.
 *
 * Based on research from: https://lilianweng.github.io/posts/2023-06-23-agent/
 *
 * Key concepts:
 * - Short-term memory: Maintained in-context via prompts, limited by token window
 * - Long-term memory: External vector store with semantic search and fast retrieval
 */

export interface ShortTermMemoryItem {
  /** Unique identifier for this memory item */
  id: string;
  /** Content of the memory (kept in context) */
  content: string;
  /** Timestamp when added to short-term memory */
  timestamp: number;
  /** Priority/relevance score (higher = more important to keep in context) */
  priority: number;
  /** Type of memory item for categorization */
  type: "task" | "observation" | "decision" | "reflection";
}

export interface LongTermMemoryItem {
  /** Unique identifier for this memory item */
  id: string;
  /** Content of the memory (stored in vector DB) */
  content: string;
  /** Timestamp when stored */
  timestamp: number;
  /** Embedding vector (for semantic search) */
  embedding?: number[];
  /** Metadata for filtering and retrieval */
  metadata: {
    source: string;
    type: string;
    tags?: string[];
  };
}

export interface MemoryArchitectureConfig {
  /** Maximum items to keep in short-term memory (context window limit) */
  shortTermCapacity: number;
  /** Token budget for short-term memory */
  shortTermTokenBudget: number;
  /** Whether to automatically promote important short-term items to long-term */
  autoPromote: boolean;
  /** Threshold for auto-promotion (priority score) */
  promotionThreshold: number;
}

/**
 * DualMemoryManager provides a clean interface for managing both
 * short-term and long-term memory with clear boundaries.
 */
export class DualMemoryManager {
  private shortTermMemory: Map<string, ShortTermMemoryItem> = new Map();
  private config: MemoryArchitectureConfig;

  constructor(config: Partial<MemoryArchitectureConfig> = {}) {
    this.config = {
      shortTermCapacity: config.shortTermCapacity ?? 20,
      shortTermTokenBudget: config.shortTermTokenBudget ?? 4000,
      autoPromote: config.autoPromote ?? true,
      promotionThreshold: config.promotionThreshold ?? 0.7,
    };
  }

  /**
   * Add an item to short-term memory (in-context).
   * Automatically manages capacity and promotes to long-term if needed.
   */
  addToShortTerm(item: Omit<ShortTermMemoryItem, "id" | "timestamp">): string {
    const id = `stm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const fullItem: ShortTermMemoryItem = {
      ...item,
      id,
      timestamp: Date.now(),
    };

    this.shortTermMemory.set(id, fullItem);

    // Capacity management: evict lowest priority items
    if (this.shortTermMemory.size > this.config.shortTermCapacity) {
      this.evictLowPriorityItems();
    }

    // Auto-promote high-priority items to long-term
    if (this.config.autoPromote && item.priority >= this.config.promotionThreshold) {
      this.promoteToLongTerm(id);
    }

    return id;
  }

  /**
   * Get all short-term memory items (for context injection).
   * Returns items sorted by priority (descending).
   */
  getShortTermContext(): ShortTermMemoryItem[] {
    return Array.from(this.shortTermMemory.values()).toSorted((a, b) => b.priority - a.priority);
  }

  /**
   * Format short-term memory for prompt injection.
   * Returns a string suitable for inclusion in the agent's context.
   */
  formatShortTermForContext(): string {
    const items = this.getShortTermContext();
    if (items.length === 0) {
      return "";
    }

    const sections: Record<string, string[]> = {
      task: [],
      observation: [],
      decision: [],
      reflection: [],
    };

    for (const item of items) {
      sections[item.type].push(`- ${item.content}`);
    }

    const parts: string[] = [];
    if (sections.task.length > 0) {
      parts.push(`Current Tasks:\n${sections.task.join("\n")}`);
    }
    if (sections.observation.length > 0) {
      parts.push(`Recent Observations:\n${sections.observation.join("\n")}`);
    }
    if (sections.decision.length > 0) {
      parts.push(`Recent Decisions:\n${sections.decision.join("\n")}`);
    }
    if (sections.reflection.length > 0) {
      parts.push(`Reflections:\n${sections.reflection.join("\n")}`);
    }

    return parts.join("\n\n");
  }

  /**
   * Clear short-term memory (e.g., at task completion).
   */
  clearShortTerm(): void {
    this.shortTermMemory.clear();
  }

  /**
   * Update priority of a short-term memory item.
   * Useful for reinforcement based on agent actions.
   */
  updatePriority(id: string, priority: number): boolean {
    const item = this.shortTermMemory.get(id);
    if (!item) {
      return false;
    }
    item.priority = priority;
    return true;
  }

  /**
   * Remove a specific item from short-term memory.
   */
  removeFromShortTerm(id: string): boolean {
    return this.shortTermMemory.delete(id);
  }

  /**
   * Promote a short-term memory item to long-term storage.
   * This is a hook point for integration with the existing OpenClaw memory system.
   */
  private promoteToLongTerm(id: string): void {
    const item = this.shortTermMemory.get(id);
    if (!item) {
      return;
    }

    // Hook point: In production, this would integrate with
    // the existing OpenClaw memory manager (src/memory/manager.ts)
    // to store the item in the vector database.
    //
    // Example integration:
    // await memoryManager.upsertChunks([{
    //   id: item.id,
    //   text: item.content,
    //   metadata: { type: item.type, priority: item.priority }
    // }]);
  }

  /**
   * Evict lowest-priority items when capacity is exceeded.
   */
  private evictLowPriorityItems(): void {
    const items = Array.from(this.shortTermMemory.entries()).toSorted(
      ([, a], [, b]) => a.priority - b.priority,
    );

    const toRemove = items.slice(0, items.length - this.config.shortTermCapacity);
    for (const [id] of toRemove) {
      this.shortTermMemory.delete(id);
    }
  }

  /**
   * Get current statistics about memory usage.
   */
  getStats(): {
    shortTermCount: number;
    shortTermCapacity: number;
    utilizationPct: number;
  } {
    const count = this.shortTermMemory.size;
    return {
      shortTermCount: count,
      shortTermCapacity: this.config.shortTermCapacity,
      utilizationPct: (count / this.config.shortTermCapacity) * 100,
    };
  }
}

/**
 * Helper function to create a memory item with appropriate priority
 * based on content type and context.
 */
export function createMemoryItem(
  content: string,
  type: ShortTermMemoryItem["type"],
  context?: {
    isUrgent?: boolean;
    isRelevantToCurrentTask?: boolean;
  },
): Omit<ShortTermMemoryItem, "id" | "timestamp"> {
  let basePriority = 0.5;

  // Type-based priority adjustments
  switch (type) {
    case "task":
      basePriority = 0.9; // Tasks are high priority
      break;
    case "decision":
      basePriority = 0.7; // Decisions are important for context
      break;
    case "observation":
      basePriority = 0.5; // Observations are medium priority
      break;
    case "reflection":
      basePriority = 0.6; // Reflections help improve future decisions
      break;
  }

  // Context-based adjustments
  if (context?.isUrgent) {
    basePriority = Math.min(1.0, basePriority + 0.2);
  }
  if (context?.isRelevantToCurrentTask) {
    basePriority = Math.min(1.0, basePriority + 0.1);
  }

  return {
    content,
    type,
    priority: basePriority,
  };
}

/**
 * Integration adapter for OpenClaw's existing memory system.
 * This provides a bridge between the dual-memory architecture and
 * the existing vector-based memory manager.
 */
export interface LongTermMemoryAdapter {
  /**
   * Store an item in long-term memory (vector database).
   */
  store(item: LongTermMemoryItem): Promise<void>;

  /**
   * Retrieve items from long-term memory using semantic search.
   */
  search(query: string, limit?: number): Promise<LongTermMemoryItem[]>;

  /**
   * Retrieve items by metadata filters.
   */
  filter(metadata: Record<string, unknown>, limit?: number): Promise<LongTermMemoryItem[]>;
}

/**
 * Factory function to create a dual-memory manager with custom configuration.
 */
export function createDualMemoryManager(
  config?: Partial<MemoryArchitectureConfig>,
): DualMemoryManager {
  return new DualMemoryManager(config);
}
