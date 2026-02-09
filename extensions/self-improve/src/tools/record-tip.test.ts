import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../store.js", () => ({
  updateTip: vi.fn().mockResolvedValue(undefined),
}));

import { updateTip } from "../store.js";
import { createRecordTipTool } from "./record-tip.js";

describe("record_tip tool", () => {
  const tool = createRecordTipTool({ config: undefined, sessionKey: "test" });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateTip).mockResolvedValue(undefined);
  });

  it("updates tip status to implemented", async () => {
    const result = await tool.execute("call-1", {
      tipId: "tip-123",
      status: "implemented",
      implementationPr: "https://github.com/openclaw/openclaw/pull/42",
      branchName: "self-improve/cache-20260208",
    });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("implemented");
    expect(parsed.implementationPr).toBe("https://github.com/openclaw/openclaw/pull/42");
    expect(updateTip).toHaveBeenCalledTimes(1);
  });

  it("updates tip status to rejected with reason", async () => {
    const result = await tool.execute("call-2", {
      tipId: "tip-456",
      status: "rejected",
      rejectionReason: "Too complex for current scope",
    });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(true);
    expect(parsed.rejectionReason).toBe("Too complex for current scope");
  });

  it("returns error for missing required fields", async () => {
    const result = await tool.execute("call-3", { tipId: "", status: "implemented" });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("required");
  });

  it("returns error for invalid status", async () => {
    const result = await tool.execute("call-4", { tipId: "tip-1", status: "invalid" });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("invalid status");
  });

  it("handles store errors gracefully", async () => {
    vi.mocked(updateTip).mockRejectedValueOnce(new Error("Record not found: tip-999"));

    const result = await tool.execute("call-5", { tipId: "tip-999", status: "planned" });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Record not found");
  });
});
