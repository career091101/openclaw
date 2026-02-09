import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { getMemorySearchManager } from "../../memory/index.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

const MemoryWriteSchema = Type.Object({
  path: Type.String({ description: "Relative path inside memory/ (e.g. memory/notes.md)" }),
  content: Type.String({ description: "Content to write" }),
  append: Type.Optional(
    Type.Boolean({ description: "Append to file instead of overwriting (default: false)" }),
  ),
});

const MemoryUpdateSchema = Type.Object({
  path: Type.String({ description: "Relative path inside memory/" }),
  fromLine: Type.Number({ description: "Start line number (1-based)" }),
  toLine: Type.Number({ description: "End line number (1-based, inclusive)" }),
  newContent: Type.String({ description: "Replacement content for the line range" }),
});

const MemoryForgetSchema = Type.Object({
  path: Type.String({ description: "Relative path inside memory/" }),
  fromLine: Type.Optional(Type.Number({ description: "Start line to delete (1-based)" })),
  toLine: Type.Optional(
    Type.Number({
      description: "End line to delete (1-based, inclusive). Omit both for full file delete.",
    }),
  ),
  reason: Type.Optional(Type.String({ description: "Reason for deletion (logged)" })),
});

export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ results: [], disabled: true, error });
      }
      try {
        const results = await manager.search(query, {
          maxResults,
          minScore,
          sessionKey: options.agentSessionKey,
        });
        const status = manager.status();
        return jsonResult({
          results,
          provider: status.provider,
          model: status.model,
          fallback: status.fallback,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ results: [], disabled: true, error: message });
      }
    },
  };
}

export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md, memory/*.md, or configured memorySearch.extraPaths with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ path: relPath, text: "", disabled: true, error });
      }
      try {
        const result = await manager.readFile({
          relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
        });
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, text: "", disabled: true, error: message });
      }
    },
  };
}

export function createMemoryWriteTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return {
    label: "Memory Write",
    name: "memory_write",
    description:
      "Write or append content to a memory file under memory/*.md. Use this to persist important information, decisions, preferences, or task progress for future recall.",
    parameters: MemoryWriteSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const content = readStringParam(params, "content", { required: true });
      const append =
        params && typeof params === "object" && "append" in params
          ? Boolean((params as Record<string, unknown>).append)
          : false;
      const { manager, error } = await getMemorySearchManager({ cfg, agentId });
      if (!manager) {
        return jsonResult({ path: relPath, error: error ?? "memory disabled", ok: false });
      }
      try {
        const result = await manager.writeMemoryFile({ relPath, content, append });
        return jsonResult({ ...result, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, error: message, ok: false });
      }
    },
  };
}

export function createMemoryUpdateTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return {
    label: "Memory Update",
    name: "memory_update",
    description:
      "Replace a specific line range in a memory file. Use after memory_get to surgically update outdated information.",
    parameters: MemoryUpdateSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const fromLine = readNumberParam(params, "fromLine", { integer: true, required: true });
      const toLine = readNumberParam(params, "toLine", { integer: true, required: true });
      const newContent = readStringParam(params, "newContent", { required: true });
      if (fromLine == null || toLine == null) {
        return jsonResult({ path: relPath, error: "fromLine and toLine are required", ok: false });
      }
      const { manager, error } = await getMemorySearchManager({ cfg, agentId });
      if (!manager) {
        return jsonResult({ path: relPath, error: error ?? "memory disabled", ok: false });
      }
      try {
        // Delete old lines then write new content
        const deleteResult = await manager.deleteMemoryLines({ relPath, fromLine, toLine });
        if (deleteResult.deleted === "file") {
          return jsonResult({ path: relPath, error: "unexpected full file delete", ok: false });
        }
        // Read current content to insert at the right position
        const current = await manager.readFile({ relPath });
        const lines = current.text.split("\n");
        const insertAt = Math.max(0, fromLine - 1);
        const newLines = newContent.split("\n");
        lines.splice(insertAt, 0, ...newLines);
        await manager.writeMemoryFile({ relPath, content: lines.join("\n") });
        return jsonResult({
          path: relPath,
          linesReplaced: toLine - fromLine + 1,
          linesInserted: newLines.length,
          ok: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, error: message, ok: false });
      }
    },
  };
}

export function createMemoryForgetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return {
    label: "Memory Forget",
    name: "memory_forget",
    description:
      "Delete lines from or entirely remove a memory file. Omit fromLine/toLine to delete the entire file. Reason is logged to memory/.forgotten-log.md for audit.",
    parameters: MemoryForgetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const fromLine = readNumberParam(params, "fromLine", { integer: true });
      const toLine = readNumberParam(params, "toLine", { integer: true });
      const reason = readStringParam(params, "reason") ?? "no reason provided";
      const { manager, error } = await getMemorySearchManager({ cfg, agentId });
      if (!manager) {
        return jsonResult({ path: relPath, error: error ?? "memory disabled", ok: false });
      }
      try {
        const result = await manager.deleteMemoryLines({
          relPath,
          fromLine: fromLine ?? undefined,
          toLine: toLine ?? undefined,
        });
        // Log the deletion to .forgotten-log.md
        const logEntry = `- ${new Date().toISOString()} | ${relPath} | ${result.deleted === "file" ? "full file" : `lines ${fromLine ?? "?"}–${toLine ?? "?"}`} | ${reason}\n`;
        await manager.writeMemoryFile({
          relPath: "memory/.forgotten-log.md",
          content: logEntry,
          append: true,
        });
        return jsonResult({ ...result, reason, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, error: message, ok: false });
      }
    },
  };
}
