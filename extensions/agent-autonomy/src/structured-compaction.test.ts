import { describe, expect, it } from "vitest";
import { createStructuredCompaction } from "./structured-compaction.js";

describe("createStructuredCompaction", () => {
  it("classifies decisions from messages", () => {
    const compaction = createStructuredCompaction();
    const result = compaction.beforeCompaction({
      messages: [
        { role: "assistant", content: "We decided to use PostgreSQL for the database." },
        { role: "user", content: "Sounds good. Let's go with that approach." },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.sections.decisions.length).toBeGreaterThan(0);
  });

  it("classifies open questions", () => {
    const compaction = createStructuredCompaction();
    const result = compaction.beforeCompaction({
      messages: [
        { role: "user", content: "Should we use Redis or Memcached for caching?" },
        { role: "assistant", content: "That's still TBD. What about the deployment strategy?" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.sections.openQuestions.length).toBeGreaterThan(0);
  });

  it("classifies TODOs", () => {
    const compaction = createStructuredCompaction();
    const result = compaction.beforeCompaction({
      messages: [
        {
          role: "assistant",
          content:
            "TODO: implement the authentication middleware\n- [ ] Add JWT validation\n- [ ] Add rate limiting",
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.sections.todos.length).toBeGreaterThan(0);
  });

  it("classifies context", () => {
    const compaction = createStructuredCompaction();
    const result = compaction.beforeCompaction({
      messages: [
        {
          role: "user",
          content:
            "Important: the API rate limit is 100 requests per minute. Keep in mind this constraint.",
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.sections.context.length).toBeGreaterThan(0);
  });

  it("handles content block arrays", () => {
    const compaction = createStructuredCompaction();
    const result = compaction.beforeCompaction({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "We decided to use TypeScript." }, { type: "image" }],
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.sections.decisions.length).toBeGreaterThan(0);
  });

  it("enhances summary in afterCompaction", () => {
    const compaction = createStructuredCompaction();
    compaction.beforeCompaction({
      messages: [{ role: "assistant", content: "We decided to use React for the frontend." }],
    });

    const event: Record<string, unknown> = { summary: "Original summary." };
    compaction.afterCompaction(event);
    expect(event.summary).toContain("Original summary.");
    expect(event.summary).toContain("Decisions Made");
  });

  it("returns null for empty messages", () => {
    const compaction = createStructuredCompaction();
    const result = compaction.beforeCompaction({ messages: [] });
    expect(result).toBeNull();
  });

  it("limits items per section", () => {
    const compaction = createStructuredCompaction();
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: "user",
      content: `We decided to implement feature ${i + 1}.`,
    }));
    const result = compaction.beforeCompaction({ messages });
    expect(result).not.toBeNull();
    expect(result!.sections.decisions.length).toBeLessThanOrEqual(20);
  });
});
