import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMemoryDecayTracker } from "./memory-decay.js";

describe("createMemoryDecayTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records access and returns entry", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/notes.md");
    const entry = tracker.getEntry("memory/notes.md");
    expect(entry).toBeDefined();
    expect(entry!.accessCount).toBe(1);
    expect(entry!.priority).toBe("normal");
  });

  it("increments access count on repeated access", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/notes.md");
    tracker.recordAccess("memory/notes.md");
    tracker.recordAccess("memory/notes.md");
    const entry = tracker.getEntry("memory/notes.md");
    expect(entry!.accessCount).toBe(3);
  });

  it("updates priority on explicit set", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/notes.md", "low");
    tracker.recordAccess("memory/notes.md", "high");
    const entry = tracker.getEntry("memory/notes.md");
    expect(entry!.priority).toBe("high");
  });

  it("recently accessed entries have higher decay scores", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/old-entry.md");

    // Advance time 14 days
    vi.advanceTimersByTime(14 * 24 * 60 * 60 * 1000);
    tracker.recordAccess("memory/recent-entry.md");

    const scores = tracker.computeScores();
    const recentEntry = scores.find((e) => e.path === "memory/recent-entry.md");
    const oldEntry = scores.find((e) => e.path === "memory/old-entry.md");
    expect(recentEntry).toBeDefined();
    expect(oldEntry).toBeDefined();
    // The entry accessed most recently should have a higher score
    expect(recentEntry!.decayScore).toBeGreaterThan(oldEntry!.decayScore);
  });

  it("critical priority entries resist decay", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/critical.md", "critical");
    tracker.recordAccess("memory/low.md", "low");

    const criticalEntry = tracker.getEntry("memory/critical.md");
    const lowEntry = tracker.getEntry("memory/low.md");
    expect(criticalEntry!.decayScore).toBeGreaterThan(lowEntry!.decayScore);
  });

  it("returns decayed entries below threshold", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/old.md", "low");

    // Advance far into the future
    vi.advanceTimersByTime(60 * 24 * 60 * 60 * 1000); // 60 days

    const decayed = tracker.getDecayedEntries(0.15);
    expect(decayed.length).toBe(1);
    expect(decayed[0].path).toBe("memory/old.md");
  });

  it("frequent access boosts score", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/popular.md");
    for (let i = 0; i < 50; i++) {
      tracker.recordAccess("memory/popular.md");
    }
    tracker.recordAccess("memory/rare.md");

    const popular = tracker.getEntry("memory/popular.md");
    const rare = tracker.getEntry("memory/rare.md");
    expect(popular!.decayScore).toBeGreaterThan(rare!.decayScore);
  });

  it("returns empty for unknown paths", () => {
    const tracker = createMemoryDecayTracker();
    expect(tracker.getEntry("nonexistent")).toBeUndefined();
  });

  it("sorts scores ascending (most decayed first)", () => {
    const tracker = createMemoryDecayTracker();
    tracker.recordAccess("memory/a.md", "critical");
    tracker.recordAccess("memory/b.md", "low");
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    tracker.recordAccess("memory/c.md", "normal");

    const scores = tracker.computeScores();
    // Should be sorted ascending by decayScore
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i].decayScore).toBeGreaterThanOrEqual(scores[i - 1].decayScore);
    }
  });
});
