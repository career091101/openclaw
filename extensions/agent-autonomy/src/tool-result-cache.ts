/**
 * Tool Result Caching: Cache deterministic tool results to improve autonomy.
 * 
 * Benefits:
 * - Reduces redundant API calls (faster, cheaper)
 * - Enables offline operation for cached data
 * - Improves agent responsiveness
 * 
 * Strategy:
 * - Content-based hashing (tool name + params)
 * - Configurable TTL per tool type
 * - LRU eviction when cache size limit is reached
 * - Skip caching for non-deterministic operations
 */

import { createHash } from "node:crypto";

export type CacheEntry<T = unknown> = {
  key: string;
  toolName: string;
  result: T;
  cachedAt: number;
  ttlMs: number;
  accessCount: number;
  lastAccessedAt: number;
};

export type CacheConfig = {
  /** Maximum number of entries (LRU eviction) */
  maxEntries: number;
  /** Default TTL in milliseconds */
  defaultTtlMs: number;
  /** Tool-specific TTL overrides */
  toolTtls?: Record<string, number>;
  /** Tools to never cache (exec, write, delete, etc.) */
  noCacheTools?: string[];
};

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxEntries: 1000,
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  toolTtls: {
    read: 10 * 60 * 1000, // 10 min - file reads are stable
    memory_get: 10 * 60 * 1000, // 10 min
    memory_search: 3 * 60 * 1000, // 3 min - memory changes less frequently
    session_status: 30 * 1000, // 30 sec - status changes frequently
  },
  noCacheTools: [
    "exec",
    "bash",
    "write",
    "edit",
    "delete",
    "memory_write",
    "memory_update",
    "memory_forget",
    "sessions_send",
    "delegate_task",
  ],
};

export class ToolResultCache {
  private cache = new Map<string, CacheEntry>();
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Generate a cache key from tool name and parameters
   */
  private generateKey(toolName: string, params: Record<string, unknown>): string {
    // Sort params keys for consistent hashing
    const sortedParams = Object.keys(params)
      .toSorted()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {} as Record<string, unknown>);
    
    const normalized = JSON.stringify({ tool: toolName, params: sortedParams });
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  /**
   * Check if a tool should be cached
   */
  private shouldCache(toolName: string): boolean {
    return !this.config.noCacheTools?.includes(toolName);
  }

  /**
   * Get TTL for a specific tool
   */
  private getTtl(toolName: string): number {
    return this.config.toolTtls?.[toolName] ?? this.config.defaultTtlMs;
  }

  /**
   * Check if a cache entry is still valid
   */
  private isValid(entry: CacheEntry): boolean {
    const age = Date.now() - entry.cachedAt;
    return age < entry.ttlMs;
  }

  /**
   * Evict LRU entries if cache is full
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.config.maxEntries) {
      return;
    }

    // Find LRU entry
    let lruKey: string | null = null;
    let lruTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  /**
   * Get a cached result if available and valid
   */
  get<T = unknown>(
    toolName: string,
    params: Record<string, unknown>,
  ): { hit: true; result: T } | { hit: false } {
    if (!this.shouldCache(toolName)) {
      return { hit: false };
    }

    const key = this.generateKey(toolName, params);
    const entry = this.cache.get(key);

    if (!entry) {
      return { hit: false };
    }

    if (!this.isValid(entry)) {
      this.cache.delete(key);
      return { hit: false };
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

    return { hit: true, result: entry.result as T };
  }

  /**
   * Store a tool result in the cache
   */
  set<T = unknown>(toolName: string, params: Record<string, unknown>, result: T): void {
    if (!this.shouldCache(toolName)) {
      return;
    }

    this.evictIfNeeded();

    const key = this.generateKey(toolName, params);
    const now = Date.now();

    this.cache.set(key, {
      key,
      toolName,
      result,
      cachedAt: now,
      ttlMs: this.getTtl(toolName),
      accessCount: 0,
      lastAccessedAt: now,
    });
  }

  /**
   * Invalidate all cached results for a specific tool
   */
  invalidateTool(toolName: string): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.toolName === toolName) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all expired entries
   */
  prune(): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isValid(entry)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    let validEntries = 0;
    let expiredEntries = 0;
    let totalAccessCount = 0;

    for (const entry of this.cache.values()) {
      if (this.isValid(entry)) {
        validEntries++;
      } else {
        expiredEntries++;
      }
      totalAccessCount += entry.accessCount;
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      totalAccessCount,
      averageAccessCount: this.cache.size > 0 ? totalAccessCount / this.cache.size : 0,
      maxEntries: this.config.maxEntries,
      utilizationPercent: (this.cache.size / this.config.maxEntries) * 100,
    };
  }
}

/**
 * Singleton cache instance for the agent autonomy system
 */
let globalCache: ToolResultCache | null = null;

export function getGlobalCache(): ToolResultCache {
  if (!globalCache) {
    globalCache = new ToolResultCache();
  }
  return globalCache;
}

export function resetGlobalCache(config?: Partial<CacheConfig>): void {
  globalCache = new ToolResultCache(config);
}

/**
 * Wrapper to execute a tool with caching
 */
export async function cachedToolExecution<T = unknown>(
  toolName: string,
  params: Record<string, unknown>,
  executeFunction: () => Promise<T>,
  cache: ToolResultCache = getGlobalCache(),
): Promise<{ result: T; cached: boolean }> {
  // Try cache first
  const cached = cache.get<T>(toolName, params);
  if (cached.hit) {
    return { result: cached.result, cached: true };
  }

  // Execute and cache
  const result = await executeFunction();
  cache.set(toolName, params, result);

  return { result, cached: false };
}
