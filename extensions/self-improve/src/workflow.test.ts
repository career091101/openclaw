import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./store.js", () => ({
  loadTips: vi.fn().mockResolvedValue([]),
  saveRun: vi.fn().mockResolvedValue(undefined),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import type { TipRecord } from "./types.js";
import { loadTips, saveRun, updateRun } from "./store.js";
import { buildTaskDag, startRun, completeRun, getBestCandidate } from "./workflow.js";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildTaskDag", () => {
  it("builds full DAG with 3 phases", () => {
    const dag = buildTaskDag({ trigger: "manual", cwd: "/test" });
    expect(dag.phases).toHaveLength(3);
    expect(dag.phases[0].role).toBe("planner");
    expect(dag.phases[1].role).toBe("executor");
    expect(dag.phases[2].role).toBe("critic");
  });

  it("builds research-only DAG for dry run", () => {
    const dag = buildTaskDag({ trigger: "manual", dryRun: true, cwd: "/test" });
    expect(dag.phases).toHaveLength(1);
    expect(dag.phases[0].role).toBe("planner");
  });

  it("includes tripwire config", () => {
    const dag = buildTaskDag({ trigger: "cron", cwd: "/test" });
    expect(dag.tripwire.maxCostUsd).toBe(2.0);
    expect(dag.tripwire.maxTokens).toBe(500_000);
    expect(dag.tripwire.maxDurationMinutes).toBe(30);
  });

  it("sets max retries to 2", () => {
    const dag = buildTaskDag({ trigger: "manual", cwd: "/test" });
    expect(dag.maxRetries).toBe(2);
  });
});

describe("startRun", () => {
  it("creates and saves a new run record", async () => {
    vi.mocked(saveRun).mockResolvedValue(undefined);
    const run = await startRun({ trigger: "manual", cwd: "/test" });
    expect(run.id).toBeTruthy();
    expect(run.status).toBe("running");
    expect(run.trigger).toBe("manual");
    expect(saveRun).toHaveBeenCalledTimes(1);
  });
});

describe("completeRun", () => {
  it("updates the run with results", async () => {
    vi.mocked(updateRun).mockResolvedValue(undefined);
    await completeRun("run-1", {
      status: "completed",
      tipsResearched: 5,
      tipsImplemented: 1,
      prsCreated: ["https://github.com/openclaw/openclaw/pull/42"],
    });
    expect(updateRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        status: "completed",
        tipsResearched: 5,
        tipsImplemented: 1,
      }),
    );
  });
});

describe("getBestCandidate", () => {
  it("returns highest-scoring evaluated tip", async () => {
    vi.mocked(loadTips).mockResolvedValue([
      makeTip({ id: "t1", scores: { relevance: 5, feasibility: 5, impact: 5, total: 15 } }),
      makeTip({ id: "t2", scores: { relevance: 9, feasibility: 9, impact: 9, total: 27 } }),
      makeTip({ id: "t3", status: "implemented" }),
    ]);

    const best = await getBestCandidate();
    expect(best?.id).toBe("t2");
  });

  it("returns specific tip by id", async () => {
    vi.mocked(loadTips).mockResolvedValue([makeTip({ id: "t1" }), makeTip({ id: "t2" })]);

    const tip = await getBestCandidate("t1");
    expect(tip?.id).toBe("t1");
  });

  it("returns null when no candidates", async () => {
    vi.mocked(loadTips).mockResolvedValue([makeTip({ id: "t1", status: "implemented" })]);

    const best = await getBestCandidate();
    expect(best).toBeNull();
  });
});
