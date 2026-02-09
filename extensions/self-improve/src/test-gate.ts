/**
 * Test gate: runs build, lint, and test checks to validate changes.
 * All three must pass for an implementation to proceed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type TestGateResult = {
  passed: boolean;
  failedStep?: "build" | "check" | "test";
  error?: string;
  durationMs: number;
};

type GateStep = {
  name: "build" | "check" | "test";
  command: string;
  args: string[];
};

const GATE_STEPS: GateStep[] = [
  { name: "build", command: "pnpm", args: ["build"] },
  { name: "check", command: "pnpm", args: ["check"] },
  { name: "test", command: "pnpm", args: ["test"] },
];

/** Run the full test gate (build → check → test). */
export async function runTestGate(cwd: string): Promise<TestGateResult> {
  const start = Date.now();

  for (const step of GATE_STEPS) {
    try {
      await execFileAsync(step.command, step.args, {
        cwd,
        timeout: 5 * 60 * 1000, // 5 min per step
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        failedStep: step.name,
        error: message.slice(0, 2000),
        durationMs: Date.now() - start,
      };
    }
  }

  return { passed: true, durationMs: Date.now() - start };
}

/** Run only the test step (for quick re-checks after fixes). */
export async function runTestOnly(cwd: string): Promise<TestGateResult> {
  const start = Date.now();
  try {
    await execFileAsync("pnpm", ["test"], {
      cwd,
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { passed: true, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      failedStep: "test",
      error: message.slice(0, 2000),
      durationMs: Date.now() - start,
    };
  }
}
