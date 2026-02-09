import { describe, it, expect, vi, beforeEach } from "vitest";
import { indexAllSkills, findRelevantSkills } from "./skill-semantic-index.js";

// Mock the skill loading and indexing modules
vi.mock("../../../src/agents/skills/workspace.js", () => ({
  loadWorkspaceSkillEntries: vi.fn(() => [
    {
      skill: {
        name: "file-reader",
        description: "Read files from the filesystem",
        filePath: "/fake/file-reader/SKILL.md",
        baseDir: "/fake/file-reader",
      },
      frontmatter: {},
      metadata: {},
      invocation: {},
    },
    {
      skill: {
        name: "slack-notify",
        description: "Send notifications to Slack channels",
        filePath: "/fake/slack-notify/SKILL.md",
        baseDir: "/fake/slack-notify",
      },
      frontmatter: {},
      metadata: {},
      invocation: {},
    },
  ]),
}));

vi.mock("../../../src/agents/skills/semantic-clustering.js", () => ({
  indexSkills: vi.fn(async () => ({
    indexed: 2,
    skipped: 0,
    errors: 0,
  })),
  searchSkillsSemantic: vi.fn(async ({ query }) => {
    if (query.includes("file")) {
      return [{ skillName: "file-reader", score: 0.95 }];
    }
    if (query.includes("slack") || query.includes("notify")) {
      return [{ skillName: "slack-notify", score: 0.92 }];
    }
    return [];
  }),
  clusterSkills: vi.fn(async () => []),
  recordSkillPattern: vi.fn(async () => {}),
  getRecommendedPatterns: vi.fn(async () => []),
}));

describe("Skill Semantic Index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it("should index all skills", async () => {
    const result = await indexAllSkills({
      workspaceDir: "/fake/workspace",
      forceReindex: false,
    });
    
    expect(result.indexed).toBe(2);
    expect(result.errors).toBe(0);
  });
  
  it("should find relevant skills for file operations", async () => {
    const results = await findRelevantSkills({
      taskDescription: "I need to read a file",
    });
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skillName).toBe("file-reader");
    expect(results[0].score).toBeGreaterThan(0.9);
  });
  
  it("should find relevant skills for notifications", async () => {
    const results = await findRelevantSkills({
      taskDescription: "Send a message to Slack",
    });
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skillName).toBe("slack-notify");
  });
  
  it("should return empty array when no relevant skills found", async () => {
    const results = await findRelevantSkills({
      taskDescription: "Something completely unrelated",
    });
    
    expect(results).toEqual([]);
  });
});
