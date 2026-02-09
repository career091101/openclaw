/**
 * Progressive context loading tool - fetch workspace context files on demand.
 * Reduces initial context window usage by allowing agents to load files only when needed.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { resolveUserPath } from "../../utils.js";
import { jsonResult, readStringParam } from "./common.js";

export type ContextFetchToolParams = {
  workspaceDir: string;
  availableFiles: Array<{ name: string; description: string }>;
};

const MAX_FILE_SIZE = 50_000; // 50KB limit per file

const ContextFetchSchema = Type.Object({
  file: Type.String({
    description: "Name of the context file to fetch (e.g., 'USER.md', 'MEMORY.md', 'TOOLS.md')",
  }),
});

export function buildContextFetchTool(params: ContextFetchToolParams): AnyAgentTool {
  return {
    label: "Context Fetch",
    name: "context_fetch",
    description:
      "Fetch additional workspace context files on demand. Use when you need details from USER.md, MEMORY.md, TOOLS.md, or other workspace files that weren't loaded initially.",
    parameters: ContextFetchSchema,
    execute: async (_toolCallId: string, args: Record<string, unknown>) => {
      try {
        const fileName = readStringParam(args, "file", { required: true });
        const filePath = path.join(resolveUserPath(params.workspaceDir), fileName);

        // Security check: ensure file is in workspace
        const resolvedPath = path.resolve(filePath);
        const resolvedWorkspace = path.resolve(resolveUserPath(params.workspaceDir));
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
          return jsonResult({
            ok: false,
            error: `Security: ${fileName} is outside workspace directory`,
          });
        }

        // Check if file exists
        let stats;
        try {
          stats = await fs.stat(filePath);
        } catch {
          return jsonResult({
            ok: false,
            error: `File not found: ${fileName}`,
          });
        }

        // Check file size
        if (stats.size > MAX_FILE_SIZE) {
          return jsonResult({
            ok: false,
            error: `File too large: ${fileName} (${stats.size} bytes, max ${MAX_FILE_SIZE})`,
            hint: "Try using memory_search or memory_get for large files",
          });
        }

        // Read file content
        const content = await fs.readFile(filePath, "utf-8");

        return jsonResult({
          ok: true,
          file: fileName,
          content,
          size: stats.size,
        });
      } catch (error) {
        const err = error as Error;
        return jsonResult({
          ok: false,
          error: `Failed to fetch context file: ${err.message}`,
        });
      }
    },
  };
}

/**
 * Build the context availability hint for the system prompt.
 * Lists which files are available for on-demand loading.
 */
export function buildContextAvailabilityHint(
  availableFiles: Array<{ name: string; description: string }>,
): string {
  const lines = [
    "## Available Context (Progressive Loading)",
    "The following workspace files can be fetched on demand using the context_fetch tool:",
    "",
  ];

  for (const file of availableFiles) {
    lines.push(`- **${file.name}**: ${file.description}`);
  }

  lines.push(
    "",
    "Load these only when needed to reduce context window usage.",
    "For large files like MEMORY.md, prefer memory_search/memory_get for targeted queries.",
  );

  return lines.join("\n");
}
