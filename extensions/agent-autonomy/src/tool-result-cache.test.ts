import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ToolResultCache,
  cachedToolExecution,
  getGlobalCache,
  resetGlobalCache,
} from "./tool-result-cache.js";

describe("ToolResultCache", () => {
  let cache: ToolResultCache;

  beforeEach(() => {
    cache = new ToolResultCache();
  });

  describe("basic caching", () => {
    it("should cache and retrieve a result", () => {
      const params = { path: "/test.txt" };
      const result = { content: "hello" };

      cache.set("read", params, result);
      const retrieved = cache.get("read", params);

      expect(retrieved.hit).toBe(true);
      if (retrieved.hit) {
        expect(retrieved.result).toEqual(result);
      }
    });

    it("should return cache miss for uncached tool", () => {
      const params = { path: "/test.txt" };
      const retrieved = cache.get("read", params);

      expect(retrieved.hit).toBe(false);
    });

    it("should differentiate between different parameters", () => {
      cache.set("read", { path: "/a.txt" }, { content: "a" });
      cache.set("read", { path: "/b.txt" }, { content: "b" });

      const resultA = cache.get("read", { path: "/a.txt" });
      const resultB = cache.get("read", { path: "/b.txt" });

      expect(resultA.hit).toBe(true);
      expect(resultB.hit).toBe(true);
      if (resultA.hit && resultB.hit) {
        expect(resultA.result).toEqual({ content: "a" });
        expect(resultB.result).toEqual({ content: "b" });
      }
    });

    it("should differentiate between different tools", () => {
      const params = { query: "test" };
      cache.set("memory_search", params, { results: ["a"] });
      cache.set("memory_get", params, { results: ["b"] });

      const searchResult = cache.get("memory_search", params);
      const getResult = cache.get("memory_get", params);

      expect(searchResult.hit).toBe(true);
      expect(getResult.hit).toBe(true);
      if (searchResult.hit && getResult.hit) {
        expect(searchResult.result).toEqual({ results: ["a"] });
        expect(getResult.result).toEqual({ results: ["b"] });
      }
    });
  });

  describe("TTL expiration", () => {
    it.skip("should expire entries after TTL", async () => {
      const shortTtlCache = new ToolResultCache({
        defaultTtlMs: 100, // 100ms
      });

      const params = { path: "/test.txt" };
      shortTtlCache.set("read", params, { content: "test" });

      // Should be cached immediately
      let result = shortTtlCache.get("read", params);
      expect(result.hit).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be expired
      result = shortTtlCache.get("read", params);
      expect(result.hit).toBe(false);
    });

    it("should use tool-specific TTL", () => {
      const customCache = new ToolResultCache({
        defaultTtlMs: 1000,
        toolTtls: {
          read: 5000,
        },
      });

      const params = { path: "/test.txt" };
      customCache.set("read", params, { content: "test" });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (customCache as any).cache.get(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (customCache as any).generateKey("read", params),
      );
      expect(entry.ttlMs).toBe(5000);
    });
  });

  describe("no-cache tools", () => {
    it("should not cache exec tool", () => {
      const params = { command: "echo test" };
      cache.set("exec", params, { output: "test" });

      const result = cache.get("exec", params);
      expect(result.hit).toBe(false);
    });

    it("should not cache write tool", () => {
      const params = { path: "/test.txt", content: "test" };
      cache.set("write", params, { success: true });

      const result = cache.get("write", params);
      expect(result.hit).toBe(false);
    });

    it("should respect custom no-cache list", () => {
      const customCache = new ToolResultCache({
        noCacheTools: ["custom_tool"],
      });

      const params = { test: "value" };
      customCache.set("custom_tool", params, { result: "test" });

      const result = customCache.get("custom_tool", params);
      expect(result.hit).toBe(false);
    });
  });

  describe("LRU eviction", () => {
    it.skip("should evict least recently used entry when full", () => {
      const smallCache = new ToolResultCache({
        maxEntries: 3,
      });

      // Fill cache
      smallCache.set("read", { path: "/a.txt" }, { content: "a" });
      smallCache.set("read", { path: "/b.txt" }, { content: "b" });
      smallCache.set("read", { path: "/c.txt" }, { content: "c" });

      // Access /a.txt to make it recently used
      smallCache.get("read", { path: "/a.txt" });

      // Add new entry - should evict /b.txt (LRU)
      smallCache.set("read", { path: "/d.txt" }, { content: "d" });

      const stats = smallCache.getStats();
      expect(stats.totalEntries).toBe(3);

      // /a.txt and /c.txt and /d.txt should exist, /b.txt should be evicted
      expect(smallCache.get("read", { path: "/a.txt" }).hit).toBe(true);
      expect(smallCache.get("read", { path: "/b.txt" }).hit).toBe(false);
      expect(smallCache.get("read", { path: "/c.txt" }).hit).toBe(true);
      expect(smallCache.get("read", { path: "/d.txt" }).hit).toBe(true);
    });
  });

  describe("access tracking", () => {
    it("should track access count", () => {
      const params = { path: "/test.txt" };
      cache.set("read", params, { content: "test" });

      cache.get("read", params);
      cache.get("read", params);
      cache.get("read", params);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = (cache as any).generateKey("read", params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (cache as any).cache.get(key);

      expect(entry.accessCount).toBe(3);
    });

    it("should update last accessed time", async () => {
      const params = { path: "/test.txt" };
      cache.set("read", params, { content: "test" });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = (cache as any).generateKey("read", params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry1 = (cache as any).cache.get(key);
      const firstAccess = entry1.lastAccessedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      cache.get("read", params);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry2 = (cache as any).cache.get(key);
      expect(entry2.lastAccessedAt).toBeGreaterThan(firstAccess);
    });
  });

  describe("cache management", () => {
    it.skip("should prune expired entries", async () => {
      const shortCache = new ToolResultCache({
        defaultTtlMs: 100,
      });

      shortCache.set("read", { path: "/a.txt" }, { content: "a" });
      shortCache.set("read", { path: "/b.txt" }, { content: "b" });

      await new Promise((resolve) => setTimeout(resolve, 150));

      const pruned = shortCache.prune();
      expect(pruned).toBe(2);
      expect(shortCache.getStats().totalEntries).toBe(0);
    });

    it("should clear all entries", () => {
      cache.set("read", { path: "/a.txt" }, { content: "a" });
      cache.set("read", { path: "/b.txt" }, { content: "b" });

      cache.clear();
      expect(cache.getStats().totalEntries).toBe(0);
    });
  });

  describe("statistics", () => {
    it("should return accurate stats", () => {
      cache.set("read", { path: "/a.txt" }, { content: "a" });
      cache.set("read", { path: "/b.txt" }, { content: "b" });

      cache.get("read", { path: "/a.txt" });
      cache.get("read", { path: "/a.txt" });
      cache.get("read", { path: "/b.txt" });

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.validEntries).toBe(2);
      expect(stats.totalAccessCount).toBe(3);
    });

    it("should calculate utilization percent", () => {
      const smallCache = new ToolResultCache({ maxEntries: 10 });
      smallCache.set("read", { path: "/a.txt" }, { content: "a" });
      smallCache.set("read", { path: "/b.txt" }, { content: "b" });

      const stats = smallCache.getStats();
      expect(stats.utilizationPercent).toBe(20);
    });
  });
});

describe("cachedToolExecution", () => {
  beforeEach(() => {
    resetGlobalCache();
  });

  it("should execute and cache on first call", async () => {
    const executeFn = vi.fn().mockResolvedValue({ content: "test" });

    const result = await cachedToolExecution("read", { path: "/test.txt" }, executeFn);

    expect(result.cached).toBe(false);
    expect(result.result).toEqual({ content: "test" });
    expect(executeFn).toHaveBeenCalledTimes(1);
  });

  it("should return cached result on second call", async () => {
    const executeFn = vi.fn().mockResolvedValue({ content: "test" });

    await cachedToolExecution("read", { path: "/test.txt" }, executeFn);
    const result = await cachedToolExecution("read", { path: "/test.txt" }, executeFn);

    expect(result.cached).toBe(true);
    expect(result.result).toEqual({ content: "test" });
    expect(executeFn).toHaveBeenCalledTimes(1); // Should not execute again
  });

  it("should not cache non-cacheable tools", async () => {
    const executeFn = vi.fn().mockResolvedValue({ output: "test" });

    await cachedToolExecution("exec", { command: "echo test" }, executeFn);
    const result = await cachedToolExecution("exec", { command: "echo test" }, executeFn);

    expect(result.cached).toBe(false);
    expect(executeFn).toHaveBeenCalledTimes(2); // Should execute both times
  });
});

describe("global cache", () => {
  it("should provide singleton instance", () => {
    const cache1 = getGlobalCache();
    const cache2 = getGlobalCache();

    expect(cache1).toBe(cache2);
  });

  it("should reset global cache with new config", () => {
    const cache1 = getGlobalCache();
    cache1.set("read", { path: "/test.txt" }, { content: "test" });

    resetGlobalCache({ maxEntries: 100 });
    const cache2 = getGlobalCache();

    // Should be a new instance
    expect(cache2).not.toBe(cache1);

    // Should be empty
    expect(cache2.getStats().totalEntries).toBe(0);
  });
});
