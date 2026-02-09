import { describe, it, expect, vi } from "vitest";
import { handleImproveSchedule } from "./improve-schedule.js";

function createMockCron(
  existingJobs: Array<{
    id: string;
    name: string;
    enabled: boolean;
    schedule: Record<string, unknown>;
    state: Record<string, unknown>;
  }> = [],
) {
  const jobs = [...existingJobs];
  return {
    list: vi.fn(async () => jobs),
    add: vi.fn(async (job: Record<string, unknown>) => {
      const created = { id: "new-job-id", ...job, state: {} };
      jobs.push(created as (typeof existingJobs)[0]);
      return created;
    }),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const job = jobs.find((j) => j.id === id);
      if (!job) throw new Error("Job not found");
      Object.assign(job, patch);
      return job;
    }),
    remove: vi.fn(async (id: string) => {
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx >= 0) jobs.splice(idx, 1);
      return { removed: idx >= 0 };
    }),
  };
}

describe("improve-schedule gateway method", () => {
  it("enables a new schedule", async () => {
    const cron = createMockCron();
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "enable" },
      respond,
      context: { cron },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        action: "enabled",
        schedule: "0 3 * * 0",
      }),
    );
    expect(cron.add).toHaveBeenCalled();
  });

  it("enables with custom cron expression", async () => {
    const cron = createMockCron();
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "enable", cronExpr: "0 0 * * 1" },
      respond,
      context: { cron },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        schedule: "0 0 * * 1",
      }),
    );
  });

  it("updates existing schedule on enable", async () => {
    const cron = createMockCron([
      {
        id: "existing-id",
        name: "self-improve-auto",
        enabled: false,
        schedule: { kind: "cron", expr: "0 3 * * 0" },
        state: {},
      },
    ]);
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "enable" },
      respond,
      context: { cron },
    });
    expect(cron.update).toHaveBeenCalledWith(
      "existing-id",
      expect.objectContaining({
        enabled: true,
      }),
    );
    expect(cron.add).not.toHaveBeenCalled();
  });

  it("disables existing schedule", async () => {
    const cron = createMockCron([
      {
        id: "existing-id",
        name: "self-improve-auto",
        enabled: true,
        schedule: { kind: "cron", expr: "0 3 * * 0" },
        state: {},
      },
    ]);
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "disable" },
      respond,
      context: { cron },
    });
    expect(cron.update).toHaveBeenCalledWith("existing-id", { enabled: false });
    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ action: "disabled" }));
  });

  it("handles disable when no schedule exists", async () => {
    const cron = createMockCron();
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "disable" },
      respond,
      context: { cron },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        message: "No schedule configured",
      }),
    );
  });

  it("removes existing schedule", async () => {
    const cron = createMockCron([
      {
        id: "existing-id",
        name: "self-improve-auto",
        enabled: true,
        schedule: { kind: "cron", expr: "0 3 * * 0" },
        state: {},
      },
    ]);
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "remove" },
      respond,
      context: { cron },
    });
    expect(cron.remove).toHaveBeenCalledWith("existing-id");
    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ action: "removed" }));
  });

  it("returns status for existing schedule", async () => {
    const cron = createMockCron([
      {
        id: "existing-id",
        name: "self-improve-auto",
        enabled: true,
        schedule: { kind: "cron", expr: "0 3 * * 0" },
        state: { nextRunAtMs: 12345 },
      },
    ]);
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "status" },
      respond,
      context: { cron },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        configured: true,
        enabled: true,
      }),
    );
  });

  it("returns not configured for status when no schedule", async () => {
    const cron = createMockCron();
    const respond = vi.fn();
    await handleImproveSchedule({
      params: { action: "status" },
      respond,
      context: { cron },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        configured: false,
      }),
    );
  });
});
