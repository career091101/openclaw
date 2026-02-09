/**
 * Structured compaction: classifies conversation messages into semantic sections
 * (decisions, openQuestions, todos, context) and produces a structured summary
 * that preserves critical information across compaction boundaries.
 */

import type { CompactionSection, CompactedSummary } from "./types.js";

type Message = {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
};

type CompactionEvent = {
  messages?: Message[];
  summary?: string;
  [key: string]: unknown;
};

/** Keyword patterns for section classification. */
const SECTION_PATTERNS: Record<CompactionSection, RegExp[]> = {
  decisions: [
    /\b(decided|decision|chose|selected|agreed|confirmed|approved|picked|went with)\b/i,
    /\b(let's go with|we'll use|the plan is|approach will be)\b/i,
  ],
  openQuestions: [
    /\b(TODO|FIXME|TBD|to be determined|open question|unresolved|need to figure out)\b/i,
    /\?\s*$/m,
    /\b(should we|do we need|what about|how should|unclear|unsure)\b/i,
  ],
  todos: [
    /\b(TODO|FIXME|HACK|task|action item|next step|remaining)\b/i,
    /^[-*]\s*\[[ x]\]/m,
    /\b(need to|must|should|will|going to)\b.*\b(implement|fix|add|create|update|remove|test|check)\b/i,
  ],
  context: [
    /\b(note|important|remember|context|background|FYI|for reference|keep in mind)\b/i,
    /\b(the reason|because|since|due to|constraint|requirement|dependency)\b/i,
  ],
};

/** Extract text from a message content. */
function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join("\n");
}

/** Classify a text segment into sections. */
function classifySegment(text: string): CompactionSection[] {
  const sections: CompactionSection[] = [];
  for (const [section, patterns] of Object.entries(SECTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        sections.push(section as CompactionSection);
        break;
      }
    }
  }
  return sections;
}

/** Break text into meaningful segments (paragraphs or list items). */
function segmentText(text: string): string[] {
  // Split on double newlines or list items
  const segments = text.split(/\n{2,}/).flatMap((paragraph) => {
    // If paragraph is a list, keep items separate
    const listItems = paragraph.split(/\n(?=[-*]\s)/).filter(Boolean);
    return listItems.length > 1 ? listItems : [paragraph];
  });
  return segments.filter((s) => s.trim().length > 0);
}

/** Build a structured summary from classified segments. */
function buildStructuredSummary(classified: Record<CompactionSection, string[]>): string {
  const parts: string[] = [];

  if (classified.decisions.length > 0) {
    parts.push("## Decisions Made");
    for (const item of classified.decisions) {
      parts.push(`- ${item.trim().slice(0, 200)}`);
    }
  }

  if (classified.openQuestions.length > 0) {
    parts.push("\n## Open Questions");
    for (const item of classified.openQuestions) {
      parts.push(`- ${item.trim().slice(0, 200)}`);
    }
  }

  if (classified.todos.length > 0) {
    parts.push("\n## TODOs");
    for (const item of classified.todos) {
      parts.push(`- ${item.trim().slice(0, 200)}`);
    }
  }

  if (classified.context.length > 0) {
    parts.push("\n## Context");
    for (const item of classified.context.slice(0, 10)) {
      parts.push(`- ${item.trim().slice(0, 200)}`);
    }
  }

  return parts.join("\n");
}

export type StructuredCompaction = {
  /** Called before compaction: extract structured sections from messages. */
  beforeCompaction(event: CompactionEvent): CompactedSummary | null;
  /** Called after compaction: enhance the summary with structured data. */
  afterCompaction(event: CompactionEvent): void;
};

export function createStructuredCompaction(): StructuredCompaction {
  let lastCompactedSummary: CompactedSummary | null = null;

  return {
    beforeCompaction(event) {
      const messages = event.messages;
      if (!messages || messages.length === 0) {
        return null;
      }

      const classified: Record<CompactionSection, string[]> = {
        decisions: [],
        openQuestions: [],
        todos: [],
        context: [],
      };

      for (const msg of messages) {
        const text = extractText(msg.content);
        if (!text) {
          continue;
        }

        const segments = segmentText(text);
        for (const segment of segments) {
          const sections = classifySegment(segment);
          for (const section of sections) {
            // Limit items per section
            if (classified[section].length < 20) {
              classified[section].push(segment);
            }
          }
        }
      }

      const summary: CompactedSummary = { sections: classified };
      lastCompactedSummary = summary;
      return summary;
    },

    afterCompaction(event) {
      if (!lastCompactedSummary) {
        return;
      }

      const structured = buildStructuredSummary(lastCompactedSummary.sections);
      if (!structured.trim()) {
        return;
      }

      // Enhance the summary with structured sections
      const existingSummary = event.summary ?? "";
      event.summary = existingSummary ? `${existingSummary}\n\n---\n\n${structured}` : structured;

      lastCompactedSummary = null;
    },
  };
}
