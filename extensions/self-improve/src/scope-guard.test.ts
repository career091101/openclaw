import { describe, it, expect } from "vitest";
import { isAllowedPath, isAllowedCommand, getPathBlockReason } from "./scope-guard.js";

describe("scope-guard", () => {
  describe("isAllowedPath", () => {
    it("allows paths in ALLOWED_PATHS", () => {
      expect(isAllowedPath("extensions/self-improve/src/types.ts")).toBe(true);
      expect(isAllowedPath("extensions/agent-autonomy/src/retry.ts")).toBe(true);
      expect(isAllowedPath("src/agents/tools/my-tool.ts")).toBe(true);
      expect(isAllowedPath("src/cli/program.ts")).toBe(true);
      expect(isAllowedPath("src/config/schema.ts")).toBe(true);
      expect(isAllowedPath("src/memory/manager.ts")).toBe(true);
      expect(isAllowedPath("scripts/build.sh")).toBe(true);
    });

    it("rejects paths in FORBIDDEN_PATHS", () => {
      expect(isAllowedPath("src/gateway/server.ts")).toBe(false);
      expect(isAllowedPath("package.json")).toBe(false);
      expect(isAllowedPath(".github/workflows/ci.yml")).toBe(false);
      expect(isAllowedPath("node_modules/foo/index.js")).toBe(false);
      expect(isAllowedPath(".env")).toBe(false);
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
      expect(isAllowedPath("src/gateway/server.test.ts")).toBe(false);
      expect(isAllowedPath("node_modules/pkg/index.test.ts")).toBe(false);
    });

    it("rejects paths not in any list", () => {
      expect(isAllowedPath("src/telegram/handler.ts")).toBe(false);
      expect(isAllowedPath("README.md")).toBe(false);
    });

    it("normalizes backslashes", () => {
      expect(isAllowedPath("extensions\\self-improve\\src\\types.ts")).toBe(true);
      expect(isAllowedPath("src\\cli\\program.ts")).toBe(true);
    });
  });

  describe("isAllowedCommand", () => {
    it("allows safe commands", () => {
      expect(isAllowedCommand("pnpm build")).toBe(true);
      expect(isAllowedCommand("pnpm test")).toBe(true);
      expect(isAllowedCommand("git add .")).toBe(true);
      expect(isAllowedCommand("git commit -m 'test'")).toBe(true);
      expect(isAllowedCommand("git push origin self-improve/test")).toBe(true);
      expect(isAllowedCommand("git push --force")).toBe(true);
      expect(isAllowedCommand("git push -f origin main")).toBe(true);
      expect(isAllowedCommand("echo rm -rf /tmp/example")).toBe(true);
    });

    it("blocks dangerous commands", () => {
      expect(isAllowedCommand("npm publish")).toBe(false);
      expect(isAllowedCommand("pnpm publish --tag beta")).toBe(false);
      expect(isAllowedCommand("npm --registry https://registry.npmjs.org publish")).toBe(false);
      expect(isAllowedCommand("git reset --hard HEAD~1")).toBe(false);
      expect(isAllowedCommand("git -c color.ui=always reset --hard HEAD~1")).toBe(false);
      expect(isAllowedCommand("rm -rf /")).toBe(false);
      expect(isAllowedCommand("rm -fr /")).toBe(false);
      expect(isAllowedCommand("rm --recursive --force /")).toBe(false);
      expect(isAllowedCommand("rm --force --recursive /")).toBe(false);
      expect(isAllowedCommand("rm -r -f /")).toBe(false);
      expect(isAllowedCommand("pnpm build && rm -rf /tmp/example")).toBe(false);
      expect(isAllowedCommand("echo ok; git reset --hard HEAD~1")).toBe(false);
    });

    it("avoids false positives with partial matches", () => {
      expect(isAllowedCommand("git reset --hardening")).toBe(true);
      expect(isAllowedCommand("npm run publish")).toBe(true);
      expect(isAllowedCommand("git help reset --hard")).toBe(true);
    });
  });

  describe("getPathBlockReason", () => {
    it("returns forbidden segment for blocked paths", () => {
      expect(getPathBlockReason("src/gateway/server/foo.ts")).toContain("src/gateway/server");
    });

    it("returns allowed list for unknown paths", () => {
      expect(getPathBlockReason("src/telegram/bot.ts")).toContain("not in allowed list");
    });
  });
});
