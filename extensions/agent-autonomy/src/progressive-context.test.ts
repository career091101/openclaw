import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  scanAvailableContext,
  filterByCategory,
  getAbbreviatedAgentsContent,
  buildProgressiveContextHint,
  estimateTokenSavings,
  STANDARD_CONTEXT_FILES,
  type ContextFileMetadata,
} from "./progressive-context.js";

describe("scanAvailableContext", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prog-context-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should find existing workspace files", async () => {
    await fs.writeFile(path.join(tmpDir, "SOUL.md"), "# Soul", "utf-8");
    await fs.writeFile(path.join(tmpDir, "USER.md"), "# User info", "utf-8");

    const available = await scanAvailableContext(tmpDir);

    const fileNames = available.map((f) => f.name);
    expect(fileNames).toContain("SOUL.md");
    expect(fileNames).toContain("USER.md");
    expect(fileNames).not.toContain("MISSING.md");
  });

  it("should include file size estimates", async () => {
    const testContent = "A".repeat(1000);
    await fs.writeFile(path.join(tmpDir, "SOUL.md"), testContent, "utf-8");

    const available = await scanAvailableContext(tmpDir);
    const soulFile = available.find((f) => f.name === "SOUL.md");

    expect(soulFile?.estimatedSize).toBe(1000);
  });

  it("should preserve category and description", async () => {
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Memory", "utf-8");

    const available = await scanAvailableContext(tmpDir);
    const memoryFile = available.find((f) => f.name === "MEMORY.md");

    expect(memoryFile?.category).toBe("on-demand");
    expect(memoryFile?.description).toContain("Long-term");
  });
});

describe("filterByCategory", () => {
  it("should filter files by category", () => {
    const files: ContextFileMetadata[] = [
      { name: "A.md", category: "essential", description: "Essential" },
      { name: "B.md", category: "on-demand", description: "On-demand" },
      { name: "C.md", category: "essential", description: "Also essential" },
    ];

    const essential = filterByCategory(files, "essential");
    const onDemand = filterByCategory(files, "on-demand");

    expect(essential).toHaveLength(2);
    expect(essential.map((f) => f.name)).toEqual(["A.md", "C.md"]);
    expect(onDemand).toHaveLength(1);
    expect(onDemand[0].name).toBe("B.md");
  });
});

describe("getAbbreviatedAgentsContent", () => {
  it("should abbreviate verbose sections", async () => {
    const fullContent = `# AGENTS.md

## First Run
Important initial instructions.

## Memory
This is a very long memory section with lots of details
about how memory works and what to do.
Multiple paragraphs here.

## Safety
Keep these safety instructions.

## Tools
Long tool descriptions
that we can defer.`;

    const result = await getAbbreviatedAgentsContent(fullContent);

    expect(result.content).toContain("## First Run");
    expect(result.content).toContain("Important initial instructions");
    expect(result.content).toContain("## Safety");
    expect(result.content).toContain("Keep these safety instructions");

    expect(result.content).not.toContain("This is a very long memory");
    expect(result.content).not.toContain("Long tool descriptions");

    expect(result.content).toContain("[Content abbreviated");
    expect(result.abbreviatedSections).toContain("## Memory");
    expect(result.abbreviatedSections).toContain("## Tools");
  });

  it("should keep non-verbose sections intact", async () => {
    const fullContent = `# AGENTS.md

## Core Instructions
These are essential.

## Another Section
Also essential.`;

    const result = await getAbbreviatedAgentsContent(fullContent);

    expect(result.content).toContain("These are essential");
    expect(result.content).toContain("Also essential");
    expect(result.abbreviatedSections).toHaveLength(0);
  });
});

describe("buildProgressiveContextHint", () => {
  it("should generate hint with file descriptions", () => {
    const files: ContextFileMetadata[] = [
      { name: "USER.md", category: "on-demand", description: "User profile", estimatedSize: 5000 },
      {
        name: "MEMORY.md",
        category: "on-demand",
        description: "Long-term memory",
        estimatedSize: 50000,
      },
    ];

    const hint = buildProgressiveContextHint(files);

    expect(hint).toContain("Progressive Context Loading");
    expect(hint).toContain("**USER.md**");
    expect(hint).toContain("User profile");
    expect(hint).toContain("**MEMORY.md**");
    expect(hint).toContain("~49KB");
    expect(hint).toContain("context_fetch");
  });

  it("should return empty string for no files", () => {
    const hint = buildProgressiveContextHint([]);
    expect(hint).toBe("");
  });
});

describe("estimateTokenSavings", () => {
  it("should estimate token savings from file sizes", () => {
    const files: ContextFileMetadata[] = [
      { name: "A.md", category: "on-demand", description: "A", estimatedSize: 4000 },
      { name: "B.md", category: "on-demand", description: "B", estimatedSize: 8000 },
    ];

    const savings = estimateTokenSavings(files);

    expect(savings.bytesDeferred).toBe(12000);
    expect(savings.estimatedTokensSaved).toBe(3000); // 12000 / 4
  });

  it("should handle missing size estimates", () => {
    const files: ContextFileMetadata[] = [
      { name: "A.md", category: "on-demand", description: "A" },
      { name: "B.md", category: "on-demand", description: "B", estimatedSize: 4000 },
    ];

    const savings = estimateTokenSavings(files);

    expect(savings.bytesDeferred).toBe(4000);
    expect(savings.estimatedTokensSaved).toBe(1000);
  });
});

describe("STANDARD_CONTEXT_FILES", () => {
  it("should classify SOUL.md and AGENTS.md as essential", () => {
    const soul = STANDARD_CONTEXT_FILES.find((f) => f.name === "SOUL.md");
    const agents = STANDARD_CONTEXT_FILES.find((f) => f.name === "AGENTS.md");

    expect(soul?.category).toBe("essential");
    expect(agents?.category).toBe("essential");
  });

  it("should classify USER.md and MEMORY.md as on-demand", () => {
    const user = STANDARD_CONTEXT_FILES.find((f) => f.name === "USER.md");
    const memory = STANDARD_CONTEXT_FILES.find((f) => f.name === "MEMORY.md");

    expect(user?.category).toBe("on-demand");
    expect(memory?.category).toBe("on-demand");
  });

  it("should have descriptions for all files", () => {
    for (const file of STANDARD_CONTEXT_FILES) {
      expect(file.description).toBeTruthy();
      expect(file.description.length).toBeGreaterThan(10);
    }
  });
});
