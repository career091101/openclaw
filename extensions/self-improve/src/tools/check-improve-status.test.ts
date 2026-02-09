import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TipRecord, RunRecord } from "../types.js";

vi.mock("../store.js", () => ({
  loadTips: vi.fn().mockResolvedValue([]),
  loadRuns: vi.fn().mockResolvedValue([]),
}));

import { loadTips, loadRuns } from "../store.js";
import { createCheckImproveStatusTool } from "./check-improve-status.js";

const makeTip = (overrides: Partial<TipRecord> = {}): TipRecord => ({
  id: "tip-1",
  title: "Test tip",
  summary: "Test summary",
  sourceUrl: "https://example.com",
  discoveredAt: Date.now(),
  scores: { relevance: 8, feasibility: 7, impact: 9, total: 24 },
  status: "evaluated",
  ...overrides,
});

const makeRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: "run-1",
  startedAt: Date.now(),
  trigger: "manual",
  status: "completed",
  tipsResearched: 5,
  tipsImplemented: 1,
  prsCreated: ["https://github.com/openclaw/openclaw/pull/1"],
  totalTokens: 10000,
  totalCostUsd: 0.5,
  ...overrides,
});

describe("check_improve_status tool", () => {
  const tool = createCheckImproveStatusTool({ config: undefined, sessionKey: "test" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tip status summary", async () => {
    vi.mocked(loadTips).mockResolvedValue([
      makeTip({ id: "t1", status: "evaluated" }),
      makeTip({ id: "t2", status: "implemented" }),
      makeTip({ id: "t3", status: "rejected" }),
      makeTip({ id: "t4", status: "evaluated" }),
    ]);

    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.ok).toBe(true);
    expect(parsed.totalTips).toBe(4);
    expect(parsed.statusCounts.evaluated).toBe(2);
    expect(parsed.statusCounts.implemented).toBe(1);
    expect(parsed.statusCounts.rejected).toBe(1);
  });

  it("includes top evaluated tips sorted by score", async () => {
    vi.mocked(loadTips).mockResolvedValue([
      makeTip({ id: "t1", scores: { relevance: 5, feasibility: 5, impact: 5, total: 15 } }),
      makeTip({ id: "t2", scores: { relevance: 9, feasibility: 9, impact: 9, total: 27 } }),
    ]);

    const result = await tool.execute("call-2", {});
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.topEvaluated[0].id).toBe("t2");
    expect(parsed.topEvaluated[0].scores.total).toBe(27);
  });

  it("includes runs when requested", async () => {
    vi.mocked(loadTips).mockResolvedValue([]);
    vi.mocked(loadRuns).mockResolvedValue([makeRun()]);

    const result = await tool.execute("call-3", { includeRuns: true });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.recentRuns).toHaveLength(1);
    expect(parsed.recentRuns[0].id).toBe("run-1");
  });

  it("returns empty summary when no data", async () => {
    vi.mocked(loadTips).mockResolvedValue([]);

    const result = await tool.execute("call-4", {});
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.ok).toBe(true);
    expect(parsed.totalTips).toBe(0);
    expect(parsed.topEvaluated).toHaveLength(0);
  });
});
