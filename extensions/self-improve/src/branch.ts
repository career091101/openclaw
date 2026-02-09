/**
 * Git branch helpers for the self-improve extension.
 * All changes are made on self-improve/* branches, never on main.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Build a branch name from a tip slug. Format: self-improve/<slug>-<YYYYMMDD> */
export function buildBranchName(tipSlug: string): string {
  const slug = tipSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `self-improve/${slug}-${date}`;
}

/** Create a new branch from main. */
export async function createBranch(name: string, cwd: string): Promise<void> {
  await execFileAsync("git", ["checkout", "-b", name, "main"], { cwd });
}

/** Delete a branch (local only). */
export async function deleteBranch(name: string, cwd: string): Promise<void> {
  // Switch to main first
  await execFileAsync("git", ["checkout", "main"], { cwd });
  await execFileAsync("git", ["branch", "-D", name], { cwd });
}

/** Get the current branch name. */
export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout.trim();
}

/** Check if a branch exists locally. */
export async function branchExists(name: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", name], { cwd });
    return true;
  } catch {
    return false;
  }
}
