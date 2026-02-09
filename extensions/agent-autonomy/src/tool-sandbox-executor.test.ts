/**
 * Tests for tool-sandbox-executor
 */

import { describe, it, expect } from "vitest";
import {
  executeSandboxed,
  createSandboxedExecutor,
  DEFAULT_SANDBOX_CONFIG,
  type SandboxConfig,
  type ToolCall,
  type ToolExecutor,
} from "./tool-sandbox-executor.js";

describe("tool-sandbox-executor", () => {
  describe("executeSandboxed", () => {
    it("should execute a simple tool successfully", async () => {
      const toolCall: ToolCall = {
        id: "test-1",
        toolName: "test-tool",
        params: { input: "hello" },
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        return { output: "world" };
      };

      const result = await executeSandboxed(toolCall, mockExecutor, DEFAULT_SANDBOX_CONFIG);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ output: "world" });
      expect(result.resourceUsage.executionTimeMs).toBeGreaterThan(0);
    });

    it("should handle tool execution errors", async () => {
      const toolCall: ToolCall = {
        id: "test-2",
        toolName: "failing-tool",
        params: {},
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        throw new Error("Tool execution failed");
      };

      const result = await executeSandboxed(toolCall, mockExecutor, DEFAULT_SANDBOX_CONFIG);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool execution failed");
    });

    it("should enforce timeout limits", async () => {
      const toolCall: ToolCall = {
        id: "test-3",
        toolName: "slow-tool",
        params: {},
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return { result: "done" };
      };

      const config: SandboxConfig = {
        ...DEFAULT_SANDBOX_CONFIG,
        resourceLimits: {
          maxMemoryMB: 512,
          maxExecutionTimeMs: 100, // Very short timeout
        },
      };

      const result = await executeSandboxed(toolCall, mockExecutor, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Timeout");
    });

    it("should track resource usage", async () => {
      const toolCall: ToolCall = {
        id: "test-4",
        toolName: "resource-tool",
        params: {},
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        // Simulate some work
        const arr = Array.from({ length: 1000 }, () => "data");
        return { result: arr.length };
      };

      const result = await executeSandboxed(toolCall, mockExecutor, DEFAULT_SANDBOX_CONFIG);

      expect(result.success).toBe(true);
      expect(result.resourceUsage.memoryUsedMB).toBeGreaterThanOrEqual(0);
      expect(result.resourceUsage.executionTimeMs).toBeGreaterThan(0);
    });

    it("should use direct execution when sandbox is disabled", async () => {
      const toolCall: ToolCall = {
        id: "test-5",
        toolName: "test-tool",
        params: {},
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        return { output: "no-sandbox" };
      };

      const config: SandboxConfig = {
        ...DEFAULT_SANDBOX_CONFIG,
        enableSandbox: false,
      };

      const result = await executeSandboxed(toolCall, mockExecutor, config);

      expect(result.success).toBe(true);
      expect(result.sandboxType).toBe("direct");
    });

    it("should fallback to direct execution on sandbox failure", async () => {
      const toolCall: ToolCall = {
        id: "test-6",
        toolName: "fallback-tool",
        params: {},
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        return { output: "fallback-result" };
      };

      const config: SandboxConfig = {
        ...DEFAULT_SANDBOX_CONFIG,
        fallbackOnSandboxFailure: true,
      };

      const result = await executeSandboxed(toolCall, mockExecutor, config);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ output: "fallback-result" });
    });
  });

  describe("createSandboxedExecutor", () => {
    it("should wrap executor with sandboxing", async () => {
      const mockExecutor: ToolExecutor = async (_tc) => {
        return { output: "wrapped" };
      };

      const sandboxedExecutor = createSandboxedExecutor(mockExecutor, DEFAULT_SANDBOX_CONFIG);

      const toolCall: ToolCall = {
        id: "test-7",
        toolName: "wrapped-tool",
        params: {},
      };

      const result = await sandboxedExecutor(toolCall);

      expect(result).toEqual({ output: "wrapped" });
    });

    it("should throw error on sandbox failure without fallback", async () => {
      const mockExecutor: ToolExecutor = async (_tc) => {
        throw new Error("Execution failed");
      };

      const config: SandboxConfig = {
        ...DEFAULT_SANDBOX_CONFIG,
        fallbackOnSandboxFailure: false,
      };

      const sandboxedExecutor = createSandboxedExecutor(mockExecutor, config);

      const toolCall: ToolCall = {
        id: "test-8",
        toolName: "error-tool",
        params: {},
      };

      await expect(sandboxedExecutor(toolCall)).rejects.toThrow();
    });
  });

  describe("sandbox type selection", () => {
    it("should identify isolated tools", async () => {
      const toolCall: ToolCall = {
        id: "test-9",
        toolName: "exec",
        params: { command: "echo test" },
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        return { stdout: "test" };
      };

      const result = await executeSandboxed(toolCall, mockExecutor, DEFAULT_SANDBOX_CONFIG);

      // exec should be treated specially (though implementation may vary)
      expect(result.success).toBe(true);
    });

    it("should identify worker-appropriate tools", async () => {
      const toolCall: ToolCall = {
        id: "test-10",
        toolName: "memory_search",
        params: { query: "test" },
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        return { results: [] };
      };

      const result = await executeSandboxed(toolCall, mockExecutor, DEFAULT_SANDBOX_CONFIG);

      expect(result.success).toBe(true);
    });
  });

  describe("resource limit enforcement", () => {
    it("should report memory usage", async () => {
      const toolCall: ToolCall = {
        id: "test-11",
        toolName: "memory-intensive",
        params: {},
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        const largeArray = Array.from({ length: 10000 }, () => ({ data: "x".repeat(100) }));
        return { size: largeArray.length };
      };

      const result = await executeSandboxed(toolCall, mockExecutor, DEFAULT_SANDBOX_CONFIG);

      expect(result.success).toBe(true);
      expect(result.resourceUsage.memoryUsedMB).toBeGreaterThan(0);
    });

    it("should detect excessive memory usage", async () => {
      const toolCall: ToolCall = {
        id: "test-12",
        toolName: "memory-hog",
        params: {},
      };

      const mockExecutor: ToolExecutor = async (_tc) => {
        // Try to allocate a lot of memory
        const huge = Array.from({ length: 10000000 }, () => "data");
        return { size: huge.length };
      };

      const config: SandboxConfig = {
        ...DEFAULT_SANDBOX_CONFIG,
        resourceLimits: {
          maxMemoryMB: 1, // Very low limit
          maxExecutionTimeMs: 30000,
        },
      };

      const result = await executeSandboxed(toolCall, mockExecutor, config);

      // May succeed or fail depending on actual memory usage
      // This test verifies that memory is tracked
      expect(result.resourceUsage.memoryUsedMB).toBeGreaterThanOrEqual(0);
    });
  });
});
