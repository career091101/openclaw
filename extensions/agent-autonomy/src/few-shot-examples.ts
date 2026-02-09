/**
 * Dynamic Few-Shot Example Injection: Meta-prompting with relevant past tool successes
 * 
 * Retrieves similar successful tool calls from history and injects them as examples
 * to improve tool use accuracy.
 */

export type ToolCallExample = {
  toolName: string;
  parameters: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  success: boolean;
  context?: string; // Optional: what the agent was trying to accomplish
};

export type FewShotConfig = {
  /** Maximum number of examples to inject (default: 3) */
  maxExamples?: number;
  
  /** Minimum similarity score to include example (0-1, default: 0.5) */
  minSimilarity?: number;
  
  /** Maximum age of examples in milliseconds (default: 30 days) */
  maxAge?: number;
  
  /** Whether to include failed examples as negative demonstrations (default: false) */
  includeNegativeExamples?: boolean;
};

export type SimilarityMetric = (
  a: ToolCallExample,
  b: Partial<ToolCallExample>
) => number;

/**
 * Calculate similarity between two tool calls based on tool name and parameter structure.
 * Returns a score from 0 (completely different) to 1 (identical).
 */
export function calculateToolSimilarity(
  example: ToolCallExample,
  query: Partial<ToolCallExample>,
): number {
  // Tool name must match
  if (example.toolName !== query.toolName) {
    return 0;
  }

  // If no parameters provided in query, just tool name match = 0.5
  if (!query.parameters) {
    return 0.5;
  }

  const exampleParams = example.parameters || {};
  const queryParams = query.parameters || {};

  // Calculate parameter similarity using Jaccard index on keys
  const exampleKeys = new Set(Object.keys(exampleParams));
  const queryKeys = new Set(Object.keys(queryParams));

  const intersection = new Set(
    [...exampleKeys].filter((k) => queryKeys.has(k))
  );
  const union = new Set([...exampleKeys, ...queryKeys]);

  const keyOverlap = intersection.size / union.size;

  // Calculate value similarity for overlapping keys
  let valueSimilarity = 0;
  let comparedValues = 0;

  for (const key of intersection) {
    const exampleValue = exampleParams[key];
    const queryValue = queryParams[key];

    if (exampleValue === queryValue) {
      valueSimilarity += 1;
    } else if (
      typeof exampleValue === typeof queryValue &&
      typeof exampleValue === "string"
    ) {
      // Partial string match using Levenshtein-like score
      const shorter = Math.min(
        String(exampleValue).length,
        String(queryValue).length
      );
      const longer = Math.max(
        String(exampleValue).length,
        String(queryValue).length
      );
      if (shorter > 0) {
        valueSimilarity += shorter / longer;
      }
    }
    comparedValues++;
  }

  const avgValueSimilarity =
    comparedValues > 0 ? valueSimilarity / comparedValues : 0;

  // Weighted combination: 60% key overlap, 40% value similarity
  return keyOverlap * 0.6 + avgValueSimilarity * 0.4;
}

/**
 * Store for tool call examples (in-memory, but can be backed by persistent storage)
 */
export class ToolExampleStore {
  private examples: ToolCallExample[] = [];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Add a new tool call example
   */
  add(example: ToolCallExample): void {
    this.examples.push(example);

    // Evict oldest if over size limit
    if (this.examples.length > this.maxSize) {
      this.examples = this.examples
        .toSorted((a, b) => b.timestamp - a.timestamp)
        .slice(0, this.maxSize);
    }
  }

  /**
   * Find similar examples for a given tool call
   */
  findSimilar(
    query: Partial<ToolCallExample>,
    config: FewShotConfig = {},
    similarityFn: SimilarityMetric = calculateToolSimilarity,
  ): ToolCallExample[] {
    const {
      maxExamples = 3,
      minSimilarity = 0.5,
      maxAge = 30 * 24 * 60 * 60 * 1000, // 30 days
      includeNegativeExamples = false,
    } = config;

    const now = Date.now();
    const ageThreshold = now - maxAge;

    // Filter and score examples
    const scored = this.examples
      .filter((ex) => {
        // Age filter
        if (ex.timestamp < ageThreshold) {
          return false;
        }

        // Success filter
        if (!includeNegativeExamples && !ex.success) {
          return false;
        }

        return true;
      })
      .map((ex) => ({
        example: ex,
        similarity: similarityFn(ex, query),
      }))
      .filter((item) => item.similarity >= minSimilarity)
      .toSorted((a, b) => b.similarity - a.similarity)
      .slice(0, maxExamples);

    return scored.map((item) => item.example);
  }

  /**
   * Get all successful examples for a specific tool
   */
  getSuccessfulForTool(toolName: string): ToolCallExample[] {
    return this.examples.filter(
      (ex) => ex.toolName === toolName && ex.success
    );
  }

  /**
   * Clear all examples (useful for testing)
   */
  clear(): void {
    this.examples = [];
  }

  /**
   * Get total count of stored examples
   */
  count(): number {
    return this.examples.length;
  }
}

/**
 * Format examples as few-shot demonstrations for injection into prompts
 */
export function formatExamplesForPrompt(
  examples: ToolCallExample[],
  format: "xml" | "json" | "markdown" = "xml",
): string {
  if (examples.length === 0) {
    return "";
  }

  const lines: string[] = [
    "",
    "Here are some examples of successful uses of this tool:",
    "",
  ];

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];

    switch (format) {
      case "xml":
        lines.push(`<example index="${i + 1}">`);
        lines.push(`  <tool>${ex.toolName}</tool>`);
        lines.push(`  <parameters>`);
        for (const [key, value] of Object.entries(ex.parameters)) {
          lines.push(
            `    <${key}>${JSON.stringify(value)}</${key}>`
          );
        }
        lines.push(`  </parameters>`);
        if (ex.context) {
          lines.push(`  <context>${ex.context}</context>`);
        }
        lines.push(`</example>`);
        break;

      case "json":
        lines.push(`Example ${i + 1}:`);
        lines.push("```json");
        lines.push(
          JSON.stringify(
            {
              tool: ex.toolName,
              parameters: ex.parameters,
              context: ex.context,
            },
            null,
            2
          )
        );
        lines.push("```");
        break;

      case "markdown":
        lines.push(`**Example ${i + 1}:**`);
        if (ex.context) {
          lines.push(`Context: ${ex.context}`);
        }
        lines.push(`Tool: \`${ex.toolName}\``);
        lines.push("Parameters:");
        for (const [key, value] of Object.entries(ex.parameters)) {
          lines.push(`- ${key}: \`${JSON.stringify(value)}\``);
        }
        break;
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Global example store instance (singleton pattern)
 */
let globalStore: ToolExampleStore | undefined;

export function getGlobalToolExampleStore(): ToolExampleStore {
  if (!globalStore) {
    globalStore = new ToolExampleStore();
  }
  return globalStore;
}

/**
 * Helper: Record a successful tool call
 */
export function recordToolSuccess(
  toolName: string,
  parameters: Record<string, unknown>,
  result: unknown,
  context?: string,
): void {
  const store = getGlobalToolExampleStore();
  store.add({
    toolName,
    parameters,
    result,
    timestamp: Date.now(),
    success: true,
    context,
  });
}

/**
 * Helper: Get few-shot examples for a tool call
 */
export function getFewShotExamples(
  toolName: string,
  parameters?: Record<string, unknown>,
  config?: FewShotConfig,
): string {
  const store = getGlobalToolExampleStore();
  const examples = store.findSimilar(
    { toolName, parameters },
    config
  );
  return formatExamplesForPrompt(examples, "xml");
}
