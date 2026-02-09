/**
 * Tests for parallel tool executor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeToolCallsInParallel,
  groupToolCallsIntoBatches,
  calculateSpeedup,
  type ToolCall,
  type ToolExecutor,
  DEFAULT_PARALLEL_CONFIG,
} from "./parallel-tool-executor.js";

describe("groupToolCallsIntoBatches", () => {
  it("should create single batch for independent read operations", () => {
    const calls: ToolCall[] = [
      { id: "1", toolName: "read", params: { path: "file1.txt" } },
      { id: "2", toolName: "read", params: { path: "file2.txt" } },
      { id: "3", toolName: "read", params: { path: "file3.txt" } },
    ];

    const batches = groupToolCallsIntoBatches(calls);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("should separate sequential tools into their own batches", () => {
    const calls: ToolCall[] = [
      { id: "1", toolName: "read", params: { path: "file1.txt" } },
      { id: "2", toolName: "write", params: { path: "file2.txt", content: "test" } },
      { id: "3", toolName: "read", params: { path: "file3.txt" } },
    ];

    const batches = groupToolCallsIntoBatches(calls);

    // [read], [write], [read]
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0][0].toolName).toBe("read");
    expect(batches[1]).toHaveLength(1);
    expect(batches[1][0].toolName).toBe("write");
    expect(batches[2]).toHaveLength(1);
    expect(batches[2][0].toolName).toBe("read");
  });

  it("should detect dependency via tool ID reference in params", () => {
    const calls: ToolCall[] = [
      { id: "tool_1", toolName: "read", params: { path: "file1.txt" } },
      { id: "tool_2", toolName: "read", params: { path: "$tool_1.result" } },
    ];

    const batches = groupToolCallsIntoBatches(calls);

    // Should be separate batches due to dependency
    expect(batches).toHaveLength(2);
  });

  it("should respect maxParallelism limit", () => {
    const calls: ToolCall[] = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      toolName: "read",
      params: { path: `file${i}.txt` },
    }));

    const batches = groupToolCallsIntoBatches(calls, {
      ...DEFAULT_PARALLEL_CONFIG,
      maxParallelism: 3,
    });

    // Should split into multiple batches of max 3
    expect(batches.length).toBeGreaterThan(1);
    batches.forEach((batch) => {
      expect(batch.length).toBeLessThanOrEqual(3);
    });
  });

  it("should handle empty tool calls array", () => {
    const batches = groupToolCallsIntoBatches([]);
    expect(batches).toHaveLength(0);
  });

  it("should group parallel reads before a sequential write", () => {
    const calls: ToolCall[] = [
      { id: "1", toolName: "read", params: { path: "a.txt" } },
      { id: "2", toolName: "read", params: { path: "b.txt" } },
      { id: "3", toolName: "write", params: { path: "c.txt", content: "test" } },
    ];

    const batches = groupToolCallsIntoBatches(calls);

    // [read, read], [write]
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
    expect(batches[1][0].toolName).toBe("write");
  });
});

describe("executeToolCallsInParallel", () => {
  let mockExecutor: ToolExecutor;
  let executionOrder: string[];

  beforeEach(() => {
    executionOrder = [];
    mockExecutor = vi.fn(async (toolCall: ToolCall) => {
      executionOrder.push(toolCall.id);
      // Simulate varying execution times
      await new Promise((resolve) => setTimeout(resolve, parseInt(toolCall.id) * 10));
      return { success: true, id: toolCall.id };
    });
  });

  it("should execute independent tools in parallel", async () => {
    const calls: ToolCall[] = [
      { id: "1", toolName: "read", params: { path: "file1.txt" } },
      { id: "2", toolName: "read", params: { path: "file2.txt" } },
      { id: "3", toolName: "read", params: { path: "file3.txt" } },
    ];

    const results = await executeToolCallsInParallel(calls, mockExecutor);

    expect(results).toHaveLength(3);
    expect(mockExecutor).toHaveBeenCalledTimes(3);

    // All should be called around the same time (order may vary due to Promise.all)
    expect(executionOrder).toHaveLength(3);
  });

  it("should preserve execution order in results", async () => {
    const calls: ToolCall[] = [
      { id: "3", toolName: "read", params: { path: "slow.txt" } },
      { id: "1", toolName: "read", params: { path: "fast.txt" } },
      { id: "2", toolName: "read", params: { path: "medium.txt" } },
    ];

    const results = await executeToolCallsInParallel(calls, mockExecutor);

    // Results should match input order, not execution completion order
    expect(results[0].id).toBe("3");
    expect(results[1].id).toBe("1");
    expect(results[2].id).toBe("2");
  });

  it("should handle tool execution errors gracefully", async () => {
    const failingExecutor: ToolExecutor = async (toolCall: ToolCall) => {
      if (toolCall.id === "2") {
        throw new Error("Tool execution failed");
      }
      return { success: true };
    };

    const calls: ToolCall[] = [
      { id: "1", toolName: "read", params: { path: "file1.txt" } },
      { id: "2", toolName: "read", params: { path: "file2.txt" } },
      { id: "3", toolName: "read", params: { path: "file3.txt" } },
    ];

    const results = await executeToolCallsInParallel(calls, failingExecutor);

    expect(results).toHaveLength(3);
    expect(results[0].error).toBeUndefined();
    expect(results[1].error).toBe("Tool execution failed");
    expect(results[2].error).toBeUndefined();
  });

  it("should execute sequential tools in order", async () => {
    const calls: ToolCall[] = [
      { id: "1", toolName: "write", params: { path: "file1.txt", content: "a" } },
      { id: "2", toolName: "write", params: { path: "file2.txt", content: "b" } },
    ];

    await executeToolCallsInParallel(calls, mockExecutor);

    // Writes should be executed sequentially
    expect(executionOrder[0]).toBe("1");
    expect(executionOrder[1]).toBe("2");
  });

  it("should handle empty tool calls", async () => {
    const results = await executeToolCallsInParallel([], mockExecutor);
    expect(results).toHaveLength(0);
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  it("should measure execution time for each tool", async () => {
    const calls: ToolCall[] = [{ id: "1", toolName: "read", params: { path: "file.txt" } }];

    const results = await executeToolCallsInParallel(calls, mockExecutor);

    expect(results[0].executionTimeMs).toBeGreaterThan(0);
  });
});

describe("calculateSpeedup", () => {
  it("should calculate speedup for fully parallelizable operations", () => {
    const results = [
      { id: "1", result: {}, executionTimeMs: 100 },
      { id: "2", result: {}, executionTimeMs: 100 },
      { id: "3", result: {}, executionTimeMs: 100 },
    ];

    const batches = [
      [
        { id: "1", toolName: "read", params: {} },
        { id: "2", toolName: "read", params: {} },
        { id: "3", toolName: "read", params: {} },
      ],
    ];

    const stats = calculateSpeedup(results, batches);

    expect(stats.sequentialTimeMs).toBe(300);
    expect(stats.parallelTimeMs).toBe(100); // Max of the batch
    expect(stats.speedup).toBeCloseTo(3.0);
    expect(stats.parallelizationRatio).toBe(1.0); // 100% parallel
  });

  it("should calculate speedup for mixed parallel and sequential", () => {
    const results = [
      { id: "1", result: {}, executionTimeMs: 100 },
      { id: "2", result: {}, executionTimeMs: 100 },
      { id: "3", result: {}, executionTimeMs: 50 },
    ];

    const batches = [
      [
        { id: "1", toolName: "read", params: {} },
        { id: "2", toolName: "read", params: {} },
      ],
      [{ id: "3", toolName: "write", params: {} }],
    ];

    const stats = calculateSpeedup(results, batches);

    expect(stats.sequentialTimeMs).toBe(250);
    expect(stats.parallelTimeMs).toBe(150); // 100 (max of first batch) + 50 (second batch)
    expect(stats.speedup).toBeCloseTo(1.67, 1);
    expect(stats.parallelizationRatio).toBe(0.5); // 1 parallel batch out of 2 total
  });

  it("should handle fully sequential execution", () => {
    const results = [
      { id: "1", result: {}, executionTimeMs: 100 },
      { id: "2", result: {}, executionTimeMs: 100 },
    ];

    const batches = [
      [{ id: "1", toolName: "write", params: {} }],
      [{ id: "2", toolName: "write", params: {} }],
    ];

    const stats = calculateSpeedup(results, batches);

    expect(stats.sequentialTimeMs).toBe(200);
    expect(stats.parallelTimeMs).toBe(200);
    expect(stats.speedup).toBe(1.0); // No speedup
    expect(stats.parallelizationRatio).toBe(0); // No parallel batches
  });
});
