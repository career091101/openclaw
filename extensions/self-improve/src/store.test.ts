import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TipRecord, RunRecord } from "./types.js";

// Mock node:fs/promises before importing the module under test
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Must import after mocking
import fs from "node:fs/promises";
import { loadTips, saveTip, updateTip, loadRuns, saveRun, updateRun } from "./store.js";

function makeTip(overrides: Partial<TipRecord> = {}): TipRecord {
  return {
    id: "tip-1",
    title: "Use caching",
    summary: "Add caching to reduce latency",
    sourceUrl: "https://example.com/tip",
    discoveredAt: 1700000000000,
    scores: { relevance: 8, feasibility: 7, impact: 9, total: 24 },
    status: "evaluated",
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    startedAt: 1700000000000,
    trigger: "manual",
    status: "running",
    tipsResearched: 0,
    tipsImplemented: 0,
    prsCreated: [],
    totalTokens: 0,
    totalCostUsd: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: mkdir always resolves
  vi.mocked(fs.mkdir).mockResolvedValue(undefined);
});

describe("loadTips", () => {
  it("returns empty array when file does not exist (ENOENT)", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    vi.mocked(fs.readFile).mockRejectedValue(err);

    const tips = await loadTips();
    expect(tips).toEqual([]);
  });

  it("parses JSONL lines into tip records", async () => {
    const tip1 = makeTip({ id: "tip-1" });
    const tip2 = makeTip({ id: "tip-2", title: "Use compression" });
    const content = JSON.stringify(tip1) + "\n" + JSON.stringify(tip2) + "\n";
    vi.mocked(fs.readFile).mockResolvedValue(content);

    const tips = await loadTips();
    expect(tips).toHaveLength(2);
    expect(tips[0].id).toBe("tip-1");
    expect(tips[1].id).toBe("tip-2");
  });

  it("skips malformed JSON lines", async () => {
    const tip = makeTip();
    const content = JSON.stringify(tip) + "\nnot-json\n";
    vi.mocked(fs.readFile).mockResolvedValue(content);

    const tips = await loadTips();
    expect(tips).toHaveLength(1);
    expect(tips[0].id).toBe("tip-1");
  });

  it("rethrows non-ENOENT errors", async () => {
    const err = new Error("EACCES") as NodeJS.ErrnoException;
    err.code = "EACCES";
    vi.mocked(fs.readFile).mockRejectedValue(err);

    await expect(loadTips()).rejects.toThrow("EACCES");
  });
});

describe("saveTip", () => {
  it("creates directory and appends a JSON line", async () => {
    vi.mocked(fs.appendFile).mockResolvedValue(undefined);
    const tip = makeTip();

    await saveTip(tip);

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("self-improve"), {
      recursive: true,
    });
    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining("tips.jsonl"),
      JSON.stringify(tip) + "\n",
      "utf-8",
    );
  });
});

describe("updateTip", () => {
  it("reads, updates matching record, and rewrites file", async () => {
    const tip1 = makeTip({ id: "tip-1" });
    const tip2 = makeTip({ id: "tip-2" });
    const content = JSON.stringify(tip1) + "\n" + JSON.stringify(tip2) + "\n";
    vi.mocked(fs.readFile).mockResolvedValue(content);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await updateTip("tip-1", { status: "implemented", implementedAt: 1700001000000 });

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    const lines = written.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const updated = JSON.parse(lines[0]) as TipRecord;
    expect(updated.id).toBe("tip-1");
    expect(updated.status).toBe("implemented");
    expect(updated.implementedAt).toBe(1700001000000);

    // Second record unchanged
    const unchanged = JSON.parse(lines[1]) as TipRecord;
    expect(unchanged.id).toBe("tip-2");
    expect(unchanged.status).toBe("evaluated");
  });

  it("throws when record is not found", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("");

    await expect(updateTip("nonexistent", { status: "rejected" })).rejects.toThrow(
      "Record not found: nonexistent",
    );
  });
});

describe("loadRuns", () => {
  it("returns empty array when file does not exist (ENOENT)", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    vi.mocked(fs.readFile).mockRejectedValue(err);

    const runs = await loadRuns();
    expect(runs).toEqual([]);
  });

  it("parses JSONL lines into run records", async () => {
    const run1 = makeRun({ id: "run-1" });
    const run2 = makeRun({ id: "run-2", trigger: "cron" });
    const content = JSON.stringify(run1) + "\n" + JSON.stringify(run2) + "\n";
    vi.mocked(fs.readFile).mockResolvedValue(content);

    const runs = await loadRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("run-1");
    expect(runs[1].trigger).toBe("cron");
  });
});

describe("saveRun", () => {
  it("creates directory and appends a JSON line", async () => {
    vi.mocked(fs.appendFile).mockResolvedValue(undefined);
    const run = makeRun();

    await saveRun(run);

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("self-improve"), {
      recursive: true,
    });
    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining("runs.jsonl"),
      JSON.stringify(run) + "\n",
      "utf-8",
    );
  });
});

describe("updateRun", () => {
  it("reads, updates matching record, and rewrites file", async () => {
    const run = makeRun({ id: "run-1" });
    const content = JSON.stringify(run) + "\n";
    vi.mocked(fs.readFile).mockResolvedValue(content);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await updateRun("run-1", {
      status: "completed",
      completedAt: 1700001000000,
      tipsResearched: 5,
      tipsImplemented: 2,
    });

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    const lines = written.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);

    const updated = JSON.parse(lines[0]) as RunRecord;
    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBe(1700001000000);
    expect(updated.tipsResearched).toBe(5);
    expect(updated.tipsImplemented).toBe(2);
  });

  it("throws when record is not found", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("");

    await expect(updateRun("nonexistent", { status: "failed" })).rejects.toThrow(
      "Record not found: nonexistent",
    );
  });
});
