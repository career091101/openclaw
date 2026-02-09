import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SkillEntry } from "./types.js";
import {
  indexSkills,
  searchSkillsSemantic,
  clusterSkills,
  recordSkillPattern,
  getRecommendedPatterns,
} from "./semantic-clustering.js";

describe("Semantic Skill Clustering", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-clustering-test-"));
    dbPath = path.join(tempDir, "test-embeddings.db");
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  const mockSkillEntry = (name: string, description: string): SkillEntry => ({
    skill: {
      name,
      description,
      filePath: `/fake/${name}/SKILL.md`,
      baseDir: `/fake/${name}`,
    },
    frontmatter: {},
    metadata: {},
    invocation: {},
  });

  it("should index skills successfully", async () => {
    const entries = [
      mockSkillEntry("file-reader", "Read files from the filesystem"),
      mockSkillEntry("file-writer", "Write files to the filesystem"),
      mockSkillEntry("slack-notify", "Send notifications to Slack channels"),
    ];

    // Mock embedding provider
    const mockProvider = {
      embed: async (text: string) => ({
        success: true,
        embedding: new Float32Array(1536).fill(0.5), // Mock embedding
      }),
    };

    const result = await indexSkills({
      entries,
      dbPath,
      embeddingProvider: mockProvider as any,
    });

    expect(result.indexed).toBe(3);
    expect(result.errors).toBe(0);
  });

  it("should skip already indexed skills with same content", async () => {
    const entries = [mockSkillEntry("test-skill", "A test skill")];

    const mockProvider = {
      embed: async (text: string) => ({
        success: true,
        embedding: new Float32Array(1536).fill(0.5),
      }),
    };

    // Index first time
    const result1 = await indexSkills({
      entries,
      dbPath,
      embeddingProvider: mockProvider as any,
    });
    expect(result1.indexed).toBe(1);

    // Index again without forceReindex
    const result2 = await indexSkills({
      entries,
      dbPath,
      embeddingProvider: mockProvider as any,
    });
    expect(result2.skipped).toBe(1);
    expect(result2.indexed).toBe(0);
  });

  it("should search skills semantically", async () => {
    const entries = [
      mockSkillEntry("file-reader", "Read files from the filesystem"),
      mockSkillEntry("database-query", "Query data from databases"),
    ];

    let callCount = 0;
    const mockProvider = {
      embed: async (text: string) => {
        callCount++;
        // Return different embeddings for different inputs
        const value = text.includes("file") ? 0.9 : 0.1;
        return {
          success: true,
          embedding: new Float32Array(1536).fill(value),
        };
      },
    };

    // Index skills
    await indexSkills({
      entries,
      dbPath,
      embeddingProvider: mockProvider as any,
    });

    // Search for file-related skills
    const results = await searchSkillsSemantic({
      query: "I need to read a file",
      dbPath,
      embeddingProvider: mockProvider as any,
      threshold: 0.5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skillName).toContain("file");
  });

  it("should record and retrieve skill patterns", async () => {
    await recordSkillPattern({
      dbPath,
      skills: ["file-reader", "data-processor", "file-writer"],
      context: "data transformation pipeline",
      success: true,
    });

    await recordSkillPattern({
      dbPath,
      skills: ["file-reader", "data-processor", "file-writer"],
      context: "data transformation pipeline",
      success: true,
    });

    await recordSkillPattern({
      dbPath,
      skills: ["slack-notify", "email-send"],
      context: "notification workflow",
      success: false,
    });

    const patterns = await getRecommendedPatterns({
      dbPath,
      limit: 5,
    });

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].successRate).toBeGreaterThan(0.5);
    expect(patterns[0].sequence).toEqual(["file-reader", "data-processor", "file-writer"]);
  });
});
