/**
 * Disk persistence for task graphs.
 * Stores orchestrations under ~/.openclaw/orchestration/.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TaskGraph } from "../../../src/agents/orchestration/types.js";
import { serializeGraph, deserializeGraph } from "./task-graph.js";

const ORCHESTRATION_DIR = path.join(os.homedir(), ".openclaw", "orchestration");

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function graphFilePath(orchestrationId: string): string {
  return path.join(ORCHESTRATION_DIR, `${orchestrationId}.json`);
}

/** Save a task graph to disk. */
export async function saveGraph(graph: TaskGraph): Promise<void> {
  await ensureDir(ORCHESTRATION_DIR);
  const filePath = graphFilePath(graph.id);
  await fs.writeFile(filePath, serializeGraph(graph), "utf-8");
}

/** Load a task graph from disk. */
export async function loadGraph(orchestrationId: string): Promise<TaskGraph | null> {
  const filePath = graphFilePath(orchestrationId);
  try {
    const json = await fs.readFile(filePath, "utf-8");
    return deserializeGraph(json);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/** List all stored orchestration IDs. */
export async function listGraphIds(): Promise<string[]> {
  try {
    await ensureDir(ORCHESTRATION_DIR);
    const entries = await fs.readdir(ORCHESTRATION_DIR);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/** Delete a task graph from disk. */
export async function deleteGraph(orchestrationId: string): Promise<void> {
  const filePath = graphFilePath(orchestrationId);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

/** Load all stored graphs (for listing). */
export async function loadAllGraphs(): Promise<TaskGraph[]> {
  const ids = await listGraphIds();
  const graphs: TaskGraph[] = [];
  for (const id of ids) {
    const graph = await loadGraph(id);
    if (graph) {
      graphs.push(graph);
    }
  }
  return graphs;
}
