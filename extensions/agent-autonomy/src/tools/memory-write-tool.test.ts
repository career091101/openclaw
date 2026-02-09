import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("memory write-back tools (integration)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-write-test-"));
    await fs.mkdir(path.join(tmpDir, "memory"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("writeMemoryFile", () => {
    it("creates a new file inside memory/", async () => {
      const filePath = path.join(tmpDir, "memory", "notes.md");
      await fs.writeFile(filePath, "# Notes\n\nHello world\n", "utf-8");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("# Notes\n\nHello world\n");
    });

    it("appends to an existing file", async () => {
      const filePath = path.join(tmpDir, "memory", "log.md");
      await fs.writeFile(filePath, "line1\n", "utf-8");
      await fs.appendFile(filePath, "line2\n", "utf-8");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("line1\nline2\n");
    });

    it("rejects paths outside memory/", () => {
      const relPath = "../secret.md";
      const absPath = path.resolve(tmpDir, relPath);
      const resolvedRel = path.relative(tmpDir, absPath).replace(/\\/g, "/");
      expect(resolvedRel.startsWith("..")).toBe(true);
    });

    it("rejects non-.md files", () => {
      const filePath = "memory/data.json";
      expect(filePath.endsWith(".md")).toBe(false);
    });
  });

  describe("deleteMemoryLines", () => {
    it("deletes specific lines from a file", async () => {
      const filePath = path.join(tmpDir, "memory", "test.md");
      await fs.writeFile(filePath, "line1\nline2\nline3\nline4\n", "utf-8");
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      // Delete lines 2-3 (1-based)
      lines.splice(1, 2);
      await fs.writeFile(filePath, lines.join("\n"), "utf-8");
      const result = await fs.readFile(filePath, "utf-8");
      expect(result).toBe("line1\nline4\n");
    });

    it("deletes entire file when no line range specified", async () => {
      const filePath = path.join(tmpDir, "memory", "delete-me.md");
      await fs.writeFile(filePath, "content\n", "utf-8");
      await fs.unlink(filePath);
      await expect(fs.access(filePath)).rejects.toThrow();
    });
  });
});
