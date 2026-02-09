import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../store.js", () => ({
  loadTips: vi.fn().mockResolvedValue([]),
  saveTip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../dedup.js", () => ({
  isDuplicate: vi.fn().mockReturnValue({ duplicate: false }),
}));

import { isDuplicate } from "../dedup.js";
import { loadTips, saveTip } from "../store.js";
import { createEvaluateTipTool } from "./evaluate-tip.js";

describe("evaluate_tip tool", () => {
  const tool = createEvaluateTipTool({ config: undefined, sessionKey: "test" });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadTips).mockResolvedValue([]);
    vi.mocked(isDuplicate).mockReturnValue({ duplicate: false });
    vi.mocked(saveTip).mockResolvedValue(undefined);
  });

  it("evaluates and saves a new tip", async () => {
    const result = await tool.execute("call-1", {
      title: "Use caching for memory lookups",
      summary: "Add an LRU cache to reduce repeated memory searches",
      sourceUrl: "https://example.com/tip",
      relevanceScore: 8,
      feasibilityScore: 7,
      impactScore: 9,
      recommendation: "accept",
      reasoning: "Highly relevant and easy to implement",
    });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(true);
    expect(parsed.scores.total).toBe(24);
    expect(parsed.status).toBe("evaluated");
    expect(saveTip).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate tips", async () => {
    vi.mocked(isDuplicate).mockReturnValue({
      duplicate: true,
      matchedTipId: "existing-1",
      similarity: 0.9,
    });

    const result = await tool.execute("call-2", {
      title: "Duplicate tip",
      summary: "Same thing",
      sourceUrl: "https://example.com/dup",
      relevanceScore: 5,
      feasibilityScore: 5,
      impactScore: 5,
      recommendation: "accept",
      reasoning: "test",
    });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("duplicate");
    expect(saveTip).not.toHaveBeenCalled();
  });

  it("marks rejected tips", async () => {
    const result = await tool.execute("call-3", {
      title: "Vague tip",
      summary: "Be better at things",
      sourceUrl: "https://example.com/vague",
      relevanceScore: 2,
      feasibilityScore: 1,
      impactScore: 1,
      recommendation: "reject",
      reasoning: "Too vague to implement",
    });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("rejected");
  });

  it("returns error for missing required fields", async () => {
    const result = await tool.execute("call-4", {
      title: "",
      summary: "test",
      sourceUrl: "https://example.com",
      relevanceScore: 5,
      feasibilityScore: 5,
      impactScore: 5,
      recommendation: "accept",
      reasoning: "test",
    });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("required");
  });
});
