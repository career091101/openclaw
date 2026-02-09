/**
 * Progressive Context Loading - reduces initial context window usage
 * by loading workspace files on demand.
 *
 * This module provides utilities to:
 * 1. Classify workspace files as "essential" vs "on-demand"
 * 2. Generate hints about available context files
 * 3. Provide a tool for fetching context files when needed
 */

import fs from "node:fs/promises";
import path from "node:path";

export type ContextFileCategory = "essential" | "on-demand";

export type ContextFileMetadata = {
  name: string;
  category: ContextFileCategory;
  description: string;
  estimatedSize?: number;
};

/**
 * Standard workspace files and their classifications.
 * Essential files are loaded immediately; on-demand files can be fetched later.
 */
export const STANDARD_CONTEXT_FILES: ContextFileMetadata[] = [
  {
    name: "SOUL.md",
    category: "essential",
    description: "Agent persona and communication style",
  },
  {
    name: "AGENTS.md",
    category: "essential",
    description: "Core agent operating instructions (abbreviated version loaded initially)",
  },
  {
    name: "USER.md",
    category: "on-demand",
    description: "Detailed user profile, preferences, and context",
  },
  {
    name: "MEMORY.md",
    category: "on-demand",
    description: "Long-term agent memory (use memory_search/memory_get for queries)",
  },
  {
    name: "TOOLS.md",
    category: "on-demand",
    description: "Tool-specific configuration and local notes",
  },
  {
    name: "IDENTITY.md",
    category: "on-demand",
    description: "Agent identity metadata (name, avatar, etc.)",
  },
  {
    name: "HEARTBEAT.md",
    category: "on-demand",
    description: "Heartbeat polling instructions and proactive task checklist",
  },
  {
    name: "BOOTSTRAP.md",
    category: "essential",
    description: "First-run initialization instructions (if present)",
  },
];

/**
 * Scan workspace directory and return metadata for available context files.
 */
export async function scanAvailableContext(workspaceDir: string): Promise<ContextFileMetadata[]> {
  const available: ContextFileMetadata[] = [];

  for (const fileMeta of STANDARD_CONTEXT_FILES) {
    const filePath = path.join(workspaceDir, fileMeta.name);
    try {
      const stats = await fs.stat(filePath);
      available.push({
        ...fileMeta,
        estimatedSize: stats.size,
      });
    } catch {
      // File doesn't exist, skip
    }
  }

  return available;
}

/**
 * Filter context files by category.
 */
export function filterByCategory(
  files: ContextFileMetadata[],
  category: ContextFileCategory,
): ContextFileMetadata[] {
  return files.filter((f) => f.category === category);
}

/**
 * Generate abbreviated version of AGENTS.md for initial context.
 * Keeps core instructions but removes verbose sections.
 */
export async function getAbbreviatedAgentsContent(
  fullContent: string,
): Promise<{ content: string; abbreviatedSections: string[] }> {
  const lines = fullContent.split("\n");
  const abbreviated: string[] = [];
  const removedSections: string[] = [];
  let currentSection: string | null = null;
  let inSkippableSection = false;
  let skippedLines: string[] = [];

  // Sections to abbreviate or skip in initial load
  const verboseSections = new Set([
    "## Memory",
    "## 💓 Heartbeats",
    "## Tools",
    "## Group Chats",
    "## External vs Internal",
  ]);

  for (const line of lines) {
    // Detect section headers
    if (line.startsWith("## ")) {
      if (inSkippableSection && skippedLines.length > 0) {
        removedSections.push(currentSection!);
        abbreviated.push(
          `[Content abbreviated - use context_fetch for full ${currentSection}]`,
          "",
        );
        skippedLines = [];
      }

      currentSection = line;
      inSkippableSection = verboseSections.has(line);
      abbreviated.push(line);
      continue;
    }

    if (inSkippableSection) {
      skippedLines.push(line);
    } else {
      abbreviated.push(line);
    }
  }

  // Handle last section
  if (inSkippableSection && skippedLines.length > 0 && currentSection) {
    removedSections.push(currentSection);
    abbreviated.push(`[Content abbreviated - use context_fetch for full ${currentSection}]`, "");
  }

  return {
    content: abbreviated.join("\n"),
    abbreviatedSections: removedSections,
  };
}

/**
 * Build system prompt hint for available on-demand context files.
 */
export function buildProgressiveContextHint(onDemandFiles: ContextFileMetadata[]): string {
  if (onDemandFiles.length === 0) {
    return "";
  }

  const lines = [
    "## Progressive Context Loading",
    "To reduce initial context window usage, some workspace files are available on-demand.",
    "Use the `context_fetch` tool when you need them:",
    "",
  ];

  for (const file of onDemandFiles) {
    const sizeHint =
      file.estimatedSize && file.estimatedSize > 10_000
        ? ` (~${Math.round(file.estimatedSize / 1024)}KB)`
        : "";
    lines.push(`- **${file.name}**${sizeHint}: ${file.description}`);
  }

  lines.push("", "Load files only when needed to conserve tokens.", "");

  return lines.join("\n");
}

/**
 * Estimate token savings from progressive loading.
 * Uses rough heuristic: 1 token ≈ 4 characters.
 */
export function estimateTokenSavings(onDemandFiles: ContextFileMetadata[]): {
  bytesDeferred: number;
  estimatedTokensSaved: number;
} {
  const totalBytes = onDemandFiles.reduce((sum, file) => sum + (file.estimatedSize ?? 0), 0);
  const estimatedTokens = Math.floor(totalBytes / 4);
  return {
    bytesDeferred: totalBytes,
    estimatedTokensSaved: estimatedTokens,
  };
}
