import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateToolSimilarity,
  ToolExampleStore,
  formatExamplesForPrompt,
  recordToolSuccess,
  getFewShotExamples,
  type ToolCallExample,
} from "./few-shot-examples.js";

describe("calculateToolSimilarity", () => {
  it("should return 0 for different tool names", () => {
    const example: ToolCallExample = {
      toolName: "read",
      parameters: { path: "file.txt" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    };

    const query = {
      toolName: "write",
      parameters: { path: "file.txt" },
    };

    expect(calculateToolSimilarity(example, query)).toBe(0);
  });

  it("should return 0.5 for matching tool name without parameters", () => {
    const example: ToolCallExample = {
      toolName: "read",
      parameters: { path: "file.txt" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    };

    const query = {
      toolName: "read",
    };

    expect(calculateToolSimilarity(example, query)).toBe(0.5);
  });

  it("should return high similarity for identical parameters", () => {
    const example: ToolCallExample = {
      toolName: "read",
      parameters: { path: "file.txt", encoding: "utf8" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    };

    const query = {
      toolName: "read",
      parameters: { path: "file.txt", encoding: "utf8" },
    };

    const similarity = calculateToolSimilarity(example, query);
    expect(similarity).toBeGreaterThan(0.9);
  });

  it("should handle partial parameter matches", () => {
    const example: ToolCallExample = {
      toolName: "read",
      parameters: { path: "file.txt", encoding: "utf8" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    };

    const query = {
      toolName: "read",
      parameters: { path: "file.txt" },
    };

    const similarity = calculateToolSimilarity(example, query);
    expect(similarity).toBeGreaterThan(0.5);
    expect(similarity).toBeLessThan(1.0);
  });

  it("should calculate string value similarity", () => {
    const example: ToolCallExample = {
      toolName: "read",
      parameters: { path: "/home/user/documents/file.txt" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    };

    const query = {
      toolName: "read",
      parameters: { path: "/home/user/downloads/file.txt" },
    };

    const similarity = calculateToolSimilarity(example, query);
    expect(similarity).toBeGreaterThan(0.5);
  });
});

describe("ToolExampleStore", () => {
  let store: ToolExampleStore;

  beforeEach(() => {
    store = new ToolExampleStore(100);
  });

  it("should add and retrieve examples", () => {
    const example: ToolCallExample = {
      toolName: "read",
      parameters: { path: "file.txt" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    };

    store.add(example);
    expect(store.count()).toBe(1);
  });

  it("should find similar examples", () => {
    // Add some examples
    store.add({
      toolName: "read",
      parameters: { path: "file1.txt" },
      result: "content1",
      timestamp: Date.now(),
      success: true,
    });

    store.add({
      toolName: "read",
      parameters: { path: "file2.txt" },
      result: "content2",
      timestamp: Date.now(),
      success: true,
    });

    store.add({
      toolName: "write",
      parameters: { path: "file3.txt" },
      result: null,
      timestamp: Date.now(),
      success: true,
    });

    const similar = store.findSimilar({
      toolName: "read",
      parameters: { path: "file1.txt" },
    });

    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0].toolName).toBe("read");
  });

  it("should respect maxExamples limit", () => {
    for (let i = 0; i < 10; i++) {
      store.add({
        toolName: "read",
        parameters: { path: `file${i}.txt` },
        result: `content${i}`,
        timestamp: Date.now(),
        success: true,
      });
    }

    const similar = store.findSimilar(
      { toolName: "read" },
      { maxExamples: 3 }
    );

    expect(similar.length).toBe(3);
  });

  it("should filter out old examples", () => {
    const now = Date.now();
    const oldTimestamp = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago

    store.add({
      toolName: "read",
      parameters: { path: "old.txt" },
      result: "old content",
      timestamp: oldTimestamp,
      success: true,
    });

    store.add({
      toolName: "read",
      parameters: { path: "new.txt" },
      result: "new content",
      timestamp: now,
      success: true,
    });

    const similar = store.findSimilar(
      { toolName: "read" },
      { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
    );

    expect(similar.length).toBe(1);
    expect(similar[0].parameters.path).toBe("new.txt");
  });

  it("should filter by success status by default", () => {
    store.add({
      toolName: "read",
      parameters: { path: "success.txt" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    });

    store.add({
      toolName: "read",
      parameters: { path: "failed.txt" },
      result: null,
      timestamp: Date.now(),
      success: false,
    });

    const similar = store.findSimilar({ toolName: "read" });

    expect(similar.length).toBe(1);
    expect(similar[0].parameters.path).toBe("success.txt");
  });

  it("should include negative examples when requested", () => {
    store.add({
      toolName: "read",
      parameters: { path: "success.txt" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    });

    store.add({
      toolName: "read",
      parameters: { path: "failed.txt" },
      result: null,
      timestamp: Date.now(),
      success: false,
    });

    const similar = store.findSimilar(
      { toolName: "read" },
      { includeNegativeExamples: true, minSimilarity: 0.3 }
    );

    expect(similar.length).toBe(2);
  });

  it("should evict old examples when size limit exceeded", () => {
    const smallStore = new ToolExampleStore(5);

    for (let i = 0; i < 10; i++) {
      smallStore.add({
        toolName: "read",
        parameters: { path: `file${i}.txt` },
        result: `content${i}`,
        timestamp: Date.now() + i, // Later examples are more recent
        success: true,
      });
    }

    expect(smallStore.count()).toBe(5);
  });

  it("should get successful examples for a specific tool", () => {
    store.add({
      toolName: "read",
      parameters: { path: "file1.txt" },
      result: "content1",
      timestamp: Date.now(),
      success: true,
    });

    store.add({
      toolName: "write",
      parameters: { path: "file2.txt" },
      result: null,
      timestamp: Date.now(),
      success: true,
    });

    const readExamples = store.getSuccessfulForTool("read");

    expect(readExamples.length).toBe(1);
    expect(readExamples[0].toolName).toBe("read");
  });

  it("should clear all examples", () => {
    store.add({
      toolName: "read",
      parameters: { path: "file.txt" },
      result: "content",
      timestamp: Date.now(),
      success: true,
    });

    expect(store.count()).toBe(1);

    store.clear();

    expect(store.count()).toBe(0);
  });
});

describe("formatExamplesForPrompt", () => {
  const examples: ToolCallExample[] = [
    {
      toolName: "read",
      parameters: { path: "file.txt", encoding: "utf8" },
      result: "content",
      timestamp: Date.now(),
      success: true,
      context: "Reading a configuration file",
    },
  ];

  it("should format examples as XML", () => {
    const formatted = formatExamplesForPrompt(examples, "xml");

    expect(formatted).toContain("<example");
    expect(formatted).toContain("<tool>read</tool>");
    expect(formatted).toContain("<path>");
    expect(formatted).toContain("<context>Reading a configuration file</context>");
  });

  it("should format examples as JSON", () => {
    const formatted = formatExamplesForPrompt(examples, "json");

    expect(formatted).toContain("```json");
    expect(formatted).toContain('"tool": "read"');
    expect(formatted).toContain('"path"');
  });

  it("should format examples as Markdown", () => {
    const formatted = formatExamplesForPrompt(examples, "markdown");

    expect(formatted).toContain("**Example 1:**");
    expect(formatted).toContain("Tool: `read`");
    expect(formatted).toContain("Context: Reading a configuration file");
  });

  it("should return empty string for no examples", () => {
    const formatted = formatExamplesForPrompt([]);
    expect(formatted).toBe("");
  });

  it("should format multiple examples", () => {
    const multipleExamples: ToolCallExample[] = [
      {
        toolName: "read",
        parameters: { path: "file1.txt" },
        result: "content1",
        timestamp: Date.now(),
        success: true,
      },
      {
        toolName: "read",
        parameters: { path: "file2.txt" },
        result: "content2",
        timestamp: Date.now(),
        success: true,
      },
    ];

    const formatted = formatExamplesForPrompt(multipleExamples, "xml");

    expect(formatted).toContain('index="1"');
    expect(formatted).toContain('index="2"');
  });
});

describe("recordToolSuccess and getFewShotExamples integration", () => {
  beforeEach(async () => {
    // Clear global store between tests
    const { getGlobalToolExampleStore } = await import("./few-shot-examples.js");
    getGlobalToolExampleStore().clear();
  });

  it("should record and retrieve examples", () => {
    recordToolSuccess(
      "read",
      { path: "test.txt" },
      "test content",
      "Reading test file"
    );

    const examples = getFewShotExamples("read", { path: "test.txt" });

    expect(examples).toContain("<example");
    expect(examples).toContain("<tool>read</tool>");
  });

  it("should not return examples for unrelated tools", () => {
    recordToolSuccess("read", { path: "test.txt" }, "content");

    const examples = getFewShotExamples("write", { path: "test.txt" });

    expect(examples).toBe("");
  });

  it("should respect similarity threshold", () => {
    recordToolSuccess("read", { path: "file1.txt" }, "content1");
    recordToolSuccess("read", { path: "file2.txt" }, "content2");

    const examples = getFewShotExamples(
      "read",
      { path: "completely-different.md" },
      { minSimilarity: 0.9 } // Very high threshold
    );

    expect(examples).toBe("");
  });
});
