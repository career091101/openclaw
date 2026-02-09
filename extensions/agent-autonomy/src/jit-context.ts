/**
 * Just-In-Time context injection: automatically injects relevant memory
 * snippets into the agent's system prompt before each turn.
 * Uses `before_agent_start` hook with a token budget to limit injection size.
 */

import type { JitContextEntry } from "./types.js";

export type MemorySearchFn = (
  query: string,
  opts?: {
    maxResults?: number;
    minScore?: number;
  },
) => Promise<
  Array<{
    path: string;
    snippet: string;
    score: number;
    startLine: number;
    endLine: number;
  }>
>;

const DEFAULT_TOKEN_BUDGET = 2000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MIN_SCORE = 0.3;
// Rough estimate: 1 token ≈ 4 characters
const CHARS_PER_TOKEN = 4;

export type JitContextInjector = {
  inject(
    event: { prompt: string; messages?: unknown[] },
    searchFn?: MemorySearchFn,
  ): Promise<{ prependContext: string } | undefined>;
};

export function createJitContextInjector(options?: {
  tokenBudget?: number;
  maxResults?: number;
  minScore?: number;
  searchFn?: MemorySearchFn;
}): JitContextInjector {
  const tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
  const charBudget = tokenBudget * CHARS_PER_TOKEN;

  return {
    async inject(event, searchFn) {
      const userMessage = event.prompt;
      if (!userMessage || userMessage.trim().length === 0) {
        return undefined;
      }

      // Use the provided search function, fall back to constructor option
      const fn = searchFn ?? options?.searchFn;
      if (!fn) {
        return undefined;
      }

      try {
        const results = await fn(userMessage, { maxResults, minScore });
        if (!results || results.length === 0) {
          return undefined;
        }

        // Build context within token budget
        const entries: JitContextEntry[] = [];
        let usedChars = 0;
        const headerChars = "\n\n## Relevant Memory Context\n".length;
        usedChars += headerChars;

        for (const result of results) {
          const entryText = `[${result.path}:${result.startLine}] ${result.snippet}`;
          const entryChars = entryText.length + 3; // "- " prefix + newline
          if (usedChars + entryChars > charBudget) {
            break;
          }
          entries.push({
            source: result.path,
            snippet: result.snippet,
            score: result.score,
          });
          usedChars += entryChars;
        }

        if (entries.length === 0) {
          return undefined;
        }

        const contextBlock = entries
          .map((e) => `- [${e.source}] ${e.snippet.slice(0, 500)}`)
          .join("\n");
        const prependContext = `\n\n## Relevant Memory Context\n${contextBlock}\n`;
        return { prependContext };
      } catch {
        // Silently skip on search failure — JIT context is best-effort
        return undefined;
      }
    },
  };
}
