import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildContextFetchTool, buildContextAvailabilityHint } from "./context-fetch-tool.js";

describe("buildContextFetchTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-fetch-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should fetch an existing file", async () => {
    const testContent = "# User Info\nTest user data";
    await fs.writeFile(path.join(tmpDir, "USER.md"), testContent, "utf-8");

    const tool = buildContextFetchTool({
      workspaceDir: tmpDir,
      availableFiles: [{ name: "USER.md", description: "User information" }],
    });

    const result = await tool.handler({ file: "USER.md" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file).toBe("USER.md");
      expect(result.content).toBe(testContent);
      expect(result.size).toBe(testContent.length);
    }
  });

  it("should return error for non-existent file", async () => {
    const tool = buildContextFetchTool({
      workspaceDir: tmpDir,
      availableFiles: [{ name: "MISSING.md", description: "Missing file" }],
    });

    const result = await tool.handler({ file: "MISSING.md" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("File not found");
    }
  });

  it("should reject files outside workspace (security check)", async () => {
    const tool = buildContextFetchTool({
      workspaceDir: tmpDir,
      availableFiles: [{ name: "../etc/passwd", description: "Hacker file" }],
    });

    const result = await tool.handler({ file: "../etc/passwd" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Security");
    }
  });

  it("should reject files larger than limit", async () => {
    // Create a 51KB file (over the 50KB limit)
    const largeContent = "x".repeat(51_000);
    await fs.writeFile(path.join(tmpDir, "LARGE.md"), largeContent, "utf-8");

    const tool = buildContextFetchTool({
      workspaceDir: tmpDir,
      availableFiles: [{ name: "LARGE.md", description: "Large file" }],
    });

    const result = await tool.handler({ file: "LARGE.md" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("File too large");
      expect(result.hint).toContain("memory_search");
    }
  });

  it("should trim file name input", async () => {
    const testContent = "# Tools";
    await fs.writeFile(path.join(tmpDir, "TOOLS.md"), testContent, "utf-8");

    const tool = buildContextFetchTool({
      workspaceDir: tmpDir,
      availableFiles: [{ name: "TOOLS.md", description: "Tools info" }],
    });

    const result = await tool.handler({ file: "  TOOLS.md  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe(testContent);
    }
  });
});

describe("buildContextAvailabilityHint", () => {
  it("should generate availability hint with file descriptions", () => {
    const files = [
      { name: "USER.md", description: "User profile and preferences" },
      { name: "MEMORY.md", description: "Long-term agent memory" },
      { name: "TOOLS.md", description: "Tool configuration and notes" },
    ];

    const hint = buildContextAvailabilityHint(files);

    expect(hint).toContain("Available Context (Progressive Loading)");
    expect(hint).toContain("**USER.md**: User profile and preferences");
    expect(hint).toContain("**MEMORY.md**: Long-term agent memory");
    expect(hint).toContain("**TOOLS.md**: Tool configuration and notes");
    expect(hint).toContain("context_fetch tool");
    expect(hint).toContain("Load these only when needed");
  });

  it("should mention memory tools for large files", () => {
    const hint = buildContextAvailabilityHint([{ name: "MEMORY.md", description: "Memory" }]);

    expect(hint).toContain("memory_search");
    expect(hint).toContain("memory_get");
  });
});
