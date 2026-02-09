import { describe, expect, it, vi } from "vitest";
import { createJitContextInjector } from "./jit-context.js";

describe("createJitContextInjector", () => {
  const mockSearchFn = vi.fn().mockResolvedValue([
    {
      path: "memory/notes.md",
      snippet: "The API uses JWT tokens for auth",
      score: 0.85,
      startLine: 1,
      endLine: 3,
    },
    {
      path: "memory/decisions.md",
      snippet: "We chose PostgreSQL over MySQL",
      score: 0.72,
      startLine: 5,
      endLine: 7,
    },
  ]);

  it("injects relevant memory context via prependContext", async () => {
    const injector = createJitContextInjector();
    const event = { prompt: "What authentication method do we use?" };
    const result = await injector.inject(event, mockSearchFn);

    expect(mockSearchFn).toHaveBeenCalledWith(
      "What authentication method do we use?",
      expect.objectContaining({ maxResults: 5 }),
    );
    expect(result).toBeDefined();
    expect(result!.prependContext).toContain("Relevant Memory Context");
    expect(result!.prependContext).toContain("JWT tokens");
  });

  it("returns undefined when no prompt", async () => {
    const injector = createJitContextInjector();
    const event = { prompt: "" };
    const result = await injector.inject(event, mockSearchFn);
    expect(result).toBeUndefined();
  });

  it("respects token budget", async () => {
    const longResults = Array.from({ length: 20 }, (_, i) => ({
      path: `memory/file${i}.md`,
      snippet: "A".repeat(500),
      score: 0.9,
      startLine: 1,
      endLine: 10,
    }));
    const longSearchFn = vi.fn().mockResolvedValue(longResults);
    // Budget of 100 tokens (~400 chars) should limit entries
    const injector = createJitContextInjector({
      tokenBudget: 100,
    });
    const event = { prompt: "test" };
    const result = await injector.inject(event, longSearchFn);
    // Should have injected something but not all 20 results
    if (result) {
      const entries = result.prependContext.split("\n").filter((l) => l.startsWith("- ["));
      expect(entries.length).toBeLessThan(20);
    }
  });

  it("returns undefined when search returns no results", async () => {
    const emptySearchFn = vi.fn().mockResolvedValue([]);
    const injector = createJitContextInjector();
    const event = { prompt: "test" };
    const result = await injector.inject(event, emptySearchFn);
    expect(result).toBeUndefined();
  });

  it("handles search function errors gracefully", async () => {
    const failingSearchFn = vi.fn().mockRejectedValue(new Error("search failed"));
    const injector = createJitContextInjector();
    const event = { prompt: "test" };
    // Should not throw
    const result = await injector.inject(event, failingSearchFn);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no search function provided", async () => {
    const injector = createJitContextInjector();
    const event = { prompt: "test" };
    const result = await injector.inject(event);
    expect(result).toBeUndefined();
  });

  it("uses constructor searchFn as fallback", async () => {
    const injector = createJitContextInjector({ searchFn: mockSearchFn });
    const event = { prompt: "test query" };
    const result = await injector.inject(event);
    expect(mockSearchFn).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.prependContext).toContain("Relevant Memory Context");
  });
});
