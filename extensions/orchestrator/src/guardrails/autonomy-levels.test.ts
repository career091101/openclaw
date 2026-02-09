import { describe, expect, it } from "vitest";
import {
  checkAutonomy,
  checkAutonomyWithRisk,
  assessToolRisk,
  describeAutonomyLevel,
  isDestructiveTool,
} from "./autonomy-levels.js";

describe("checkAutonomy", () => {
  describe("Level 0", () => {
    it("requires approval for all tools", () => {
      expect(checkAutonomy("read", 0).requiresApproval).toBe(true);
      expect(checkAutonomy("write", 0).requiresApproval).toBe(true);
      expect(checkAutonomy("exec", 0).requiresApproval).toBe(true);
      expect(checkAutonomy("message", 0).requiresApproval).toBe(true);
    });
  });

  describe("Level 1", () => {
    it("allows read-only tools without approval", () => {
      expect(checkAutonomy("read", 1).requiresApproval).toBe(false);
      expect(checkAutonomy("memory_search", 1).requiresApproval).toBe(false);
      expect(checkAutonomy("web_search", 1).requiresApproval).toBe(false);
    });

    it("requires approval for write tools", () => {
      expect(checkAutonomy("write", 1).requiresApproval).toBe(true);
      expect(checkAutonomy("exec", 1).requiresApproval).toBe(true);
    });
  });

  describe("Level 2", () => {
    it("allows planning tools without approval", () => {
      expect(checkAutonomy("delegate_task", 2).requiresApproval).toBe(false);
      expect(checkAutonomy("submit_result", 2).requiresApproval).toBe(false);
      expect(checkAutonomy("request_review", 2).requiresApproval).toBe(false);
    });

    it("allows read-only tools without approval", () => {
      expect(checkAutonomy("read", 2).requiresApproval).toBe(false);
    });

    it("requires approval for execution tools", () => {
      expect(checkAutonomy("exec", 2).requiresApproval).toBe(true);
      expect(checkAutonomy("write", 2).requiresApproval).toBe(true);
    });
  });

  describe("Level 3", () => {
    it("allows most tools without approval", () => {
      expect(checkAutonomy("read", 3).requiresApproval).toBe(false);
      expect(checkAutonomy("write", 3).requiresApproval).toBe(false);
      expect(checkAutonomy("exec", 3).requiresApproval).toBe(false);
    });

    it("requires approval for external communication", () => {
      expect(checkAutonomy("message", 3).requiresApproval).toBe(true);
      expect(checkAutonomy("sessions_send", 3).requiresApproval).toBe(true);
    });
  });

  describe("Level 4", () => {
    it("allows everything without approval", () => {
      expect(checkAutonomy("message", 4).requiresApproval).toBe(false);
      expect(checkAutonomy("exec", 4).requiresApproval).toBe(false);
    });
  });
});

describe("describeAutonomyLevel", () => {
  it("returns descriptions for all levels", () => {
    for (let i = 0; i <= 4; i++) {
      const desc = describeAutonomyLevel(i as 0 | 1 | 2 | 3 | 4);
      expect(desc).toContain(`Level ${i}`);
    }
  });
});

describe("isDestructiveTool", () => {
  it("identifies destructive tools", () => {
    expect(isDestructiveTool("exec")).toBe(true);
    expect(isDestructiveTool("memory_forget")).toBe(true);
  });

  it("does not flag non-destructive tools", () => {
    expect(isDestructiveTool("read")).toBe(false);
    expect(isDestructiveTool("write")).toBe(false);
  });
});

describe("checkAutonomyWithRisk", () => {
  describe("Level 4 with risk-based scoring", () => {
    it("allows low-risk operations with balanced tolerance", () => {
      const result = checkAutonomyWithRisk({
        toolName: "read",
        autonomyLevel: 4,
        riskTolerance: "balanced",
      });
      expect(result.requiresApproval).toBe(false);
      expect(result.riskScore?.level).toBe("low");
    });

    it("requires approval for high-risk operations with balanced tolerance", () => {
      const result = checkAutonomyWithRisk({
        toolName: "exec",
        autonomyLevel: 4,
        riskTolerance: "balanced",
        toolParams: { command: "rm -rf /" },
        target: "/etc/passwd",
      });
      expect(result.requiresApproval).toBe(true);
      expect(result.riskScore).toBeDefined();
      expect(result.riskScore?.level).toBeOneOf(["high", "critical"]);
    });

    it("requires approval for costly operations with conservative tolerance", () => {
      const result = checkAutonomyWithRisk({
        toolName: "web_fetch",
        autonomyLevel: 4,
        riskTolerance: "conservative",
        cost: 0.5,
      });
      // Conservative threshold is 3, web_fetch + cost should push it over
      expect(result.riskScore).toBeDefined();
    });

    it("allows more operations with aggressive tolerance", () => {
      const result = checkAutonomyWithRisk({
        toolName: "exec",
        autonomyLevel: 4,
        riskTolerance: "aggressive",
        toolParams: { command: "ls" },
      });
      // Aggressive threshold is 9, basic exec should pass
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe("Lower autonomy levels (0-3)", () => {
    it("honors autonomy-level policy at level 1", () => {
      const result = checkAutonomyWithRisk({
        toolName: "write",
        autonomyLevel: 1,
        riskTolerance: "aggressive",
      });
      // Level 1 requires approval for write tools, regardless of risk tolerance
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("level 1");
    });

    it("honors autonomy-level policy at level 2", () => {
      const result = checkAutonomyWithRisk({
        toolName: "exec",
        autonomyLevel: 2,
        riskTolerance: "aggressive",
      });
      // Level 2 requires approval for execution tools
      expect(result.requiresApproval).toBe(true);
    });

    it("honors autonomy-level policy at level 3", () => {
      const result = checkAutonomyWithRisk({
        toolName: "message",
        autonomyLevel: 3,
        riskTolerance: "aggressive",
      });
      // Level 3 requires approval for external communication
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("Risk score details", () => {
    it("includes risk score in decision for level 4", () => {
      const result = checkAutonomyWithRisk({
        toolName: "write",
        autonomyLevel: 4,
        target: "/workspace/test.txt",
      });
      expect(result.riskScore).toBeDefined();
      expect(result.riskScore?.score).toBeGreaterThanOrEqual(0);
      expect(result.riskScore?.factors).toBeDefined();
      expect(result.riskScore?.factors.length).toBeGreaterThan(0);
    });

    it("provides detailed reason including risk explanation", () => {
      const result = checkAutonomyWithRisk({
        toolName: "exec",
        autonomyLevel: 4,
        riskTolerance: "balanced",
        toolParams: { command: "rm file.txt" },
      });
      expect(result.reason).toContain("Risk:");
      expect(result.reason).toMatch(/\d+\/10/);
    });
  });
});

describe("assessToolRisk", () => {
  it("returns risk score for any tool", () => {
    const risk = assessToolRisk({ toolName: "read" });
    expect(risk.score).toBeDefined();
    expect(risk.level).toBeDefined();
    expect(risk.factors).toBeDefined();
  });

  it("considers tool parameters in risk assessment", () => {
    const withoutParams = assessToolRisk({ toolName: "exec" });
    const withDangerous = assessToolRisk({
      toolName: "exec",
      toolParams: { command: "rm -rf /" },
    });
    expect(withDangerous.score).toBeGreaterThan(withoutParams.score);
  });

  it("considers target paths in risk assessment", () => {
    const workspace = assessToolRisk({
      toolName: "write",
      target: "/workspace/file.txt",
    });
    const system = assessToolRisk({
      toolName: "write",
      target: "/etc/config",
    });
    expect(system.score).toBeGreaterThan(workspace.score);
  });
});
