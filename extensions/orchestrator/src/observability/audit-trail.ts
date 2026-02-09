/**
 * Cognitive audit trail: records all orchestration events to JSONL files
 * for debugging, compliance, and behavior analysis.
 * Stored at ~/.openclaw/orchestration/audit-{id}.jsonl
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const AUDIT_DIR = path.join(os.homedir(), ".openclaw", "orchestration");

export type AuditEntry = {
  timestamp: number;
  orchestrationId?: string;
  type: string;
  toolName?: string;
  toolCallId?: string;
  sessionKey?: string;
  role?: string;
  taskId?: string;
  data?: Record<string, unknown>;
};

export type AuditTrail = {
  /** Record a tool call event. */
  recordToolCall(event: Record<string, unknown>): void;
  /** Record a custom event. */
  recordEvent(entry: AuditEntry): void;
  /** Flush pending writes to disk. */
  flush(): Promise<void>;
  /** Read the audit trail for an orchestration. */
  readAuditLog(orchestrationId: string): Promise<AuditEntry[]>;
};

export function createAuditTrail(): AuditTrail {
  const pendingWrites = new Map<string, AuditEntry[]>();
  let flushTimer: NodeJS.Timeout | null = null;
  const FLUSH_INTERVAL_MS = 5000;

  function scheduleFlush() {
    if (flushTimer) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void doFlush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
  }

  async function doFlush(): Promise<void> {
    if (pendingWrites.size === 0) {
      return;
    }
    const entries = new Map(pendingWrites);
    pendingWrites.clear();

    await fs.mkdir(AUDIT_DIR, { recursive: true });

    for (const [orchestrationId, items] of entries) {
      const filePath = path.join(AUDIT_DIR, `audit-${orchestrationId}.jsonl`);
      const lines = items.map((item) => JSON.stringify(item)).join("\n") + "\n";
      await fs.appendFile(filePath, lines, "utf-8");
    }
  }

  function addEntry(entry: AuditEntry): void {
    const id = entry.orchestrationId ?? "__global__";
    const existing = pendingWrites.get(id) ?? [];
    existing.push(entry);
    pendingWrites.set(id, existing);
    scheduleFlush();
  }

  return {
    recordToolCall(event) {
      const entry: AuditEntry = {
        timestamp: Date.now(),
        orchestrationId:
          typeof event.orchestrationId === "string" ? event.orchestrationId : undefined,
        type: "tool_call",
        toolName: typeof event.toolName === "string" ? event.toolName : undefined,
        toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
        sessionKey: typeof event.sessionKey === "string" ? event.sessionKey : undefined,
        role: typeof event.role === "string" ? event.role : undefined,
        taskId: typeof event.taskId === "string" ? event.taskId : undefined,
        data: {
          hasError: Boolean(event.error),
          exitCode: event.exitCode,
        },
      };
      addEntry(entry);
    },

    recordEvent(entry) {
      addEntry({ ...entry, timestamp: entry.timestamp ?? Date.now() });
    },

    async flush() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await doFlush();
    },

    async readAuditLog(orchestrationId) {
      const filePath = path.join(AUDIT_DIR, `audit-${orchestrationId}.jsonl`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return content
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as AuditEntry;
            } catch {
              return null;
            }
          })
          .filter((entry): entry is AuditEntry => entry != null);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw err;
      }
    },
  };
}
