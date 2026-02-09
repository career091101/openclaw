import { describe, expect, it } from "vitest";
import { checkAutonomy, describeAutonomyLevel, isDestructiveTool } from "./autonomy-levels.js";

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
