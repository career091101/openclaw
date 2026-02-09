import { describe, it, expect } from "vitest";
import { buildAgentMessage } from "./context-bridge.js";

describe("context-bridge", () => {
  describe("buildAgentMessage", () => {
    it("includes existing tip titles", () => {
      const msg = buildAgentMessage({
        existingTipTitles: ["Tip A", "Tip B"],
      });
      expect(msg).toContain("Tip A");
      expect(msg).toContain("Tip B");
      expect(msg).toContain("avoid duplicates");
    });

    it("includes dry-run flag", () => {
      const msg = buildAgentMessage({
        dryRun: true,
        existingTipTitles: [],
      });
      expect(msg).toContain("DRY RUN");
      expect(msg).toContain("do NOT implement");
    });

    it("includes full mode when not dry-run", () => {
      const msg = buildAgentMessage({
        dryRun: false,
        existingTipTitles: [],
      });
      expect(msg).toContain("FULL");
    });

    it("includes target tip ID when specified", () => {
      const msg = buildAgentMessage({
        tipId: "abc-123",
        existingTipTitles: [],
      });
      expect(msg).toContain("abc-123");
      expect(msg).toContain("Target Tip");
    });

    it("includes max tips count", () => {
      const msg = buildAgentMessage({
        maxTips: 5,
        existingTipTitles: [],
      });
      expect(msg).toContain("5");
    });

    it("defaults max tips to 10", () => {
      const msg = buildAgentMessage({
        existingTipTitles: [],
      });
      expect(msg).toContain("10");
    });

    it("shows first run message when no existing tips", () => {
      const msg = buildAgentMessage({
        existingTipTitles: [],
      });
      expect(msg).toContain("first run");
    });

    it("includes last run summary when provided", () => {
      const msg = buildAgentMessage({
        existingTipTitles: [],
        lastRunSummary: "Researched 3 tips, implemented 1",
      });
      expect(msg).toContain("Researched 3 tips");
      expect(msg).toContain("Last Run Summary");
    });

    it("includes the self-improve system prompt", () => {
      const msg = buildAgentMessage({
        existingTipTitles: [],
      });
      expect(msg).toContain("self-improvement loop");
      expect(msg).toContain("check_improve_status");
    });
  });
});
