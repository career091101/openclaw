/**
 * JSONL-based persistence store for self-improve tip and run records.
 * Stores data at ~/.openclaw/self-improve/tips.jsonl and runs.jsonl.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TipRecord, RunRecord } from "./types.js";

const STORE_DIR = path.join(os.homedir(), ".openclaw", "self-improve");
const TIPS_FILE = path.join(STORE_DIR, "tips.jsonl");
const RUNS_FILE = path.join(STORE_DIR, "runs.jsonl");

/** Read all lines from a JSONL file, returning parsed objects. */
async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is T => entry != null);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/** Append a single record as a JSONL line. */
async function appendJsonl<T>(filePath: string, record: T): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
}

/** Read all records, update one by id with a partial, and rewrite the file. */
async function updateJsonl<T extends { id: string }>(
  filePath: string,
  id: string,
  partial: Partial<T>,
): Promise<void> {
  const records = await readJsonl<T>(filePath);
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) {
    throw new Error(`Record not found: ${id}`);
  }
  records[index] = { ...records[index], ...partial };
  await fs.mkdir(STORE_DIR, { recursive: true });
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await fs.writeFile(filePath, content, "utf-8");
}

// --- Tips ---

/** Load all tip records from disk. */
export async function loadTips(): Promise<TipRecord[]> {
  return readJsonl<TipRecord>(TIPS_FILE);
}

/** Append a new tip record to disk. */
export async function saveTip(tip: TipRecord): Promise<void> {
  await appendJsonl(TIPS_FILE, tip);
}

/** Update an existing tip record by id with a partial update. */
export async function updateTip(id: string, partial: Partial<TipRecord>): Promise<void> {
  await updateJsonl<TipRecord>(TIPS_FILE, id, partial);
}

// --- Runs ---

/** Load all run records from disk. */
export async function loadRuns(): Promise<RunRecord[]> {
  return readJsonl<RunRecord>(RUNS_FILE);
}

/** Append a new run record to disk. */
export async function saveRun(run: RunRecord): Promise<void> {
  await appendJsonl(RUNS_FILE, run);
}

/** Update an existing run record by id with a partial update. */
export async function updateRun(id: string, partial: Partial<RunRecord>): Promise<void> {
  await updateJsonl<RunRecord>(RUNS_FILE, id, partial);
}
