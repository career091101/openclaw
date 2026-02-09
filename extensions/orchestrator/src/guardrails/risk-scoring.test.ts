import { describe, it, expect } from "vitest";
import {
  calculateRiskScore,
  checkRiskThreshold,
  explainRiskScore,
  type RiskTolerance,
} from "./risk-scoring.js";

describe("calculateRiskScore", () => {
  it("assigns low risk to read-only tools", () => {
    const result = calculateRiskScore({ toolName: "read" });
    expect(result.level).toBe("low");
    expect(result.score).toBeLessThan(3);
  });

  it("assigns medium risk to workspace write tools", () => {
    const result = calculateRiskScore({
      toolName: "write",
      target: "/workspace/test.txt",
    });
    expect(result.level).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeLessThan(6);
  });

  it("assigns high risk to exec tools", () => {
    const result = calculateRiskScore({
      toolName: "exec",
      toolParams: { command: "ls -la" },
    });
    expect(result.level).toBeOneOf(["high", "critical"]);
    expect(result.score).toBeGreaterThanOrEqual(6);
  });

  it("increases risk for system-level targets", () => {
    const workspaceWrite = calculateRiskScore({
      toolName: "write",
      target: "/workspace/test.txt",
    });
    const systemWrite = calculateRiskScore({
      toolName: "write",
      target: "/etc/config",
    });
    expect(systemWrite.score).toBeGreaterThan(workspaceWrite.score);
  });

  it("increases risk for irreversible operations", () => {
    const reversible = calculateRiskScore({ toolName: "write" });
    const irreversible = calculateRiskScore({ toolName: "memory_forget" });
    expect(irreversible.score).toBeGreaterThan(reversible.score);
  });

  it("increases risk for costly operations", () => {
    const noCost = calculateRiskScore({ toolName: "web_fetch" });
    const highCost = calculateRiskScore({
      toolName: "web_fetch",
      cost: 2.0,
    });
    expect(highCost.score).toBeGreaterThan(noCost.score);
    expect(highCost.factors).toContain("high cost $2.00 (+3)");
  });

  it("detects security-sensitive patterns in file paths", () => {
    const normal = calculateRiskScore({
      toolName: "read",
      target: "/workspace/notes.txt",
    });
    const sensitive = calculateRiskScore({
      toolName: "read",
      target: "/workspace/.env",
    });
    expect(sensitive.score).toBeGreaterThan(normal.score);
    expect(sensitive.factors).toContain("security-sensitive (+2)");
  });

  it("detects dangerous exec commands", () => {
    const safe = calculateRiskScore({
      toolName: "exec",
      toolParams: { command: "ls" },
    });
    const dangerous = calculateRiskScore({
      toolName: "exec",
      toolParams: { command: "rm -rf /" },
    });
    expect(dangerous.score).toBeGreaterThan(safe.score);
    expect(dangerous.factors).toContain("security-sensitive (+2)");
  });

  it("increases risk for batch operations", () => {
    const single = calculateRiskScore({
      toolName: "write",
      toolParams: { path: "file.txt" },
    });
    const batch = calculateRiskScore({
      toolName: "write",
      toolParams: { paths: ["file1.txt", "file2.txt", "file3.txt"] },
    });
    expect(batch.score).toBeGreaterThan(single.score);
    expect(batch.factors).toContain("batch operation (+1)");
  });

  it("clamps scores to 0-10 range", () => {
    const result = calculateRiskScore({
      toolName: "exec",
      target: "/etc/passwd",
      cost: 10.0,
      toolParams: { command: "rm -rf /" },
    });
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("checkRiskThreshold", () => {
  it("requires approval for high risk with conservative tolerance", () => {
    const risk = calculateRiskScore({ toolName: "exec" });
    const result = checkRiskThreshold(risk, "conservative");
    expect(result.requiresApproval).toBe(true);
  });

  it("does not require approval for low risk with conservative tolerance", () => {
    const risk = calculateRiskScore({ toolName: "read" });
    const result = checkRiskThreshold(risk, "conservative");
    expect(result.requiresApproval).toBe(false);
  });

  it("requires approval for medium risk with conservative tolerance", () => {
    const risk = calculateRiskScore({ toolName: "write" });
    const result = checkRiskThreshold(risk, "conservative");
    expect(result.requiresApproval).toBe(true);
  });

  it("allows medium risk with balanced tolerance", () => {
    const risk = calculateRiskScore({ toolName: "write" });
    const result = checkRiskThreshold(risk, "balanced");
    expect(result.requiresApproval).toBe(false);
  });

  it("requires approval for high risk with balanced tolerance", () => {
    const risk = calculateRiskScore({
      toolName: "exec",
      toolParams: { command: "rm file.txt" },
    });
    const result = checkRiskThreshold(risk, "balanced");
    expect(result.requiresApproval).toBe(true);
  });

  it("allows most operations with aggressive tolerance", () => {
    const risk = calculateRiskScore({ toolName: "exec" });
    const result = checkRiskThreshold(risk, "aggressive");
    // exec baseline is 7, which is below aggressive threshold of 9
    expect(result.requiresApproval).toBe(false);
  });

  it("requires approval for critical risk with any tolerance", () => {
    const risk = calculateRiskScore({
      toolName: "memory_forget",
      target: "/etc/passwd",
      toolParams: { command: "rm -rf /" },
    });
    const tolerances: RiskTolerance[] = ["conservative", "balanced", "aggressive"];
    for (const tolerance of tolerances) {
      const result = checkRiskThreshold(risk, tolerance);
      if (risk.score >= 9) {
        expect(result.requiresApproval).toBe(true);
      }
    }
  });
});

describe("explainRiskScore", () => {
  it("provides human-readable explanation", () => {
    const risk = calculateRiskScore({
      toolName: "exec",
      target: "/etc/config",
    });
    const explanation = explainRiskScore(risk);
    expect(explanation).toContain("Risk:");
    expect(explanation).toContain(risk.level);
    expect(explanation).toContain("Factors:");
  });
});
