/**
 * record_tip tool: updates the status of an existing tip record.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { updateTip } from "../store.js";

const RecordTipSchema = Type.Object({
  tipId: Type.String({ description: "ID of the tip to update" }),
  status: Type.String({
    description: "New status: planned, implementing, implemented, rejected, or failed",
  }),
  implementationPr: Type.Optional(Type.String({ description: "URL of the implementation PR" })),
  branchName: Type.Optional(Type.String({ description: "Git branch name for the implementation" })),
  orchestrationId: Type.Optional(
    Type.String({ description: "Orchestration ID managing this tip" }),
  ),
  rejectionReason: Type.Optional(Type.String({ description: "Reason for rejection or failure" })),
});

export function createRecordTipTool(_options: { config?: OpenClawConfig; sessionKey?: string }) {
  return {
    label: "Record Tip",
    name: "record_tip",
    description:
      "Update the status of a tip record. Use this to mark tips as planned, implementing, implemented, rejected, or failed.",
    parameters: RecordTipSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const tipId = typeof params.tipId === "string" ? params.tipId : "";
      const status = typeof params.status === "string" ? params.status : "";
      const implementationPr =
        typeof params.implementationPr === "string" ? params.implementationPr : undefined;
      const branchName = typeof params.branchName === "string" ? params.branchName : undefined;
      const orchestrationId =
        typeof params.orchestrationId === "string" ? params.orchestrationId : undefined;
      const rejectionReason =
        typeof params.rejectionReason === "string" ? params.rejectionReason : undefined;

      if (!tipId || !status) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "tipId and status are required", ok: false }),
            },
          ],
        };
      }

      const validStatuses = ["planned", "implementing", "implemented", "rejected", "failed"];
      if (!validStatuses.includes(status)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `invalid status: ${status}`, ok: false }),
            },
          ],
        };
      }

      try {
        const update: Record<string, unknown> = { status };
        if (implementationPr) {
          update.implementationPr = implementationPr;
        }
        if (branchName) {
          update.branchName = branchName;
        }
        if (orchestrationId) {
          update.orchestrationId = orchestrationId;
        }
        if (rejectionReason) {
          update.rejectionReason = rejectionReason;
        }
        if (status === "implemented") {
          update.implementedAt = Date.now();
        }

        await updateTip(tipId, update);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true, tipId, status, ...update }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message, ok: false }) }],
        };
      }
    },
  };
}
