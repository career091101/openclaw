import { describe, it, expect } from "vitest";
import { isAllowedPath, isAllowedCommand, getPathBlockReason } from "./scope-guard.js";

describe("scope-guard", () => {
  describe("isAllowedPath", () => {
    it("allows paths in ALLOWED_PATHS", () => {
      expect(isAllowedPath("extensions/self-improve/src/types.ts")).toBe(true);
      expect(isAllowedPath("extensions/agent-autonomy/src/retry.ts")).toBe(true);
      expect(isAllowedPath("src/agents/tools/my-tool.ts")).toBe(true);
      expect(isAllowedPath("src/memory/manager.ts")).toBe(true);
    });

    it("rejects paths in FORBIDDEN_PATHS", () => {
      expect(isAllowedPath("src/config/schema.ts")).toBe(false);
      expect(isAllowedPath("src/gateway/server.ts")).toBe(false);
      expect(isAllowedPath("src/cli/program.ts")).toBe(false);
      expect(isAllowedPath("package.json")).toBe(false);
      expect(isAllowedPath(".github/workflows/ci.yml")).toBe(false);
      expect(isAllowedPath("scripts/build.sh")).toBe(false);
    });

    it("allows src/plugins/ paths", () => {
      expect(isAllowedPath("src/plugins/runtime/index.ts")).toBe(true);
      expect(isAllowedPath("src/plugins/loader.ts")).toBe(true);
    });

    it("allows test files outside ALLOWED_PATHS", () => {
      expect(isAllowedPath("src/telegram/handler.test.ts")).toBe(true);
      expect(isAllowedPath("src/discord/bot.test.ts")).toBe(true);
    });

    it("still blocks test files in FORBIDDEN_PATHS", () => {
      expect(isAllowedPath("src/config/schema.test.ts")).toBe(false);
      expect(isAllowedPath("src/gateway/server.test.ts")).toBe(false);
    });

    it("rejects paths not in any list", () => {
      expect(isAllowedPath("src/telegram/handler.ts")).toBe(false);
      expect(isAllowedPath("README.md")).toBe(false);
    });

    it("normalizes backslashes", () => {
      expect(isAllowedPath("extensions\\self-improve\\src\\types.ts")).toBe(true);
    });
  });

  describe("isAllowedCommand", () => {
    it("allows safe commands", () => {
      expect(isAllowedCommand("pnpm build")).toBe(true);
      expect(isAllowedCommand("pnpm test")).toBe(true);
      expect(isAllowedCommand("git add .")).toBe(true);
      expect(isAllowedCommand("git commit -m 'test'")).toBe(true);
      expect(isAllowedCommand("git push origin self-improve/test")).toBe(true);
    });

    it("blocks dangerous commands", () => {
      expect(isAllowedCommand("git push --force")).toBe(false);
      expect(isAllowedCommand("git push -f origin main")).toBe(false);
      expect(isAllowedCommand("rm -rf /")).toBe(false);
      expect(isAllowedCommand("npm publish")).toBe(false);
      expect(isAllowedCommand("git reset --hard HEAD~1")).toBe(false);
    });
  });

  describe("getPathBlockReason", () => {
    it("returns forbidden segment for blocked paths", () => {
      expect(getPathBlockReason("src/config/foo.ts")).toContain("src/config/");
    });

    it("returns allowed list for unknown paths", () => {
      expect(getPathBlockReason("src/telegram/bot.ts")).toContain("not in allowed list");
    });
  });
});
