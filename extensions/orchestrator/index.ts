import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createHandoffToAgentTool } from "./src/agent-handoff/tool.js";
import { createTripwireMonitor } from "./src/guardrails/tripwire.js";
import { createAuditTrail } from "./src/observability/audit-trail.js";
import { createCheckTaskStatusTool } from "./src/tools/check-task-status.js";
import { createDelegateTaskTool } from "./src/tools/delegate-task.js";
import { createMultiAgentDebateTool } from "./src/tools/multi-agent-debate.js";
import { createRequestReviewTool } from "./src/tools/request-review.js";
import { createSubmitResultTool } from "./src/tools/submit-result.js";

/** Resolve a per-agent feature flag from config, falling back to defaults. */
function resolveAgentFeature(
  config: unknown,
  agentId: string | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const cfg = config as Record<string, unknown> | undefined;
  const agents = cfg?.agents as Record<string, unknown> | undefined;
  const list = agents?.list as Array<Record<string, unknown>> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;

  // Find matching agent entry
  if (agentId && Array.isArray(list)) {
    const entry = list.find(
      (a) => typeof a.id === "string" && a.id.toLowerCase() === agentId.toLowerCase(),
    );
    if (entry?.[key] && typeof entry[key] === "object") {
      return entry[key] as Record<string, unknown>;
    }
  }

  // Fall back to defaults
  if (defaults?.[key] && typeof defaults[key] === "object") {
    return defaults[key] as Record<string, unknown>;
  }
  return undefined;
}

const orchestratorPlugin = {
  id: "orchestrator",
  name: "Orchestrator",
  description: "Multi-agent orchestration with supervisor, task graph, and progressive autonomy",
  kind: "orchestration",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // Register orchestration tools
    api.registerTool(
      (ctx) => {
        const config = ctx.config;
        const orchestration = resolveAgentFeature(config, ctx.agentId, "orchestration");
        if (!orchestration?.enabled) {
          return null;
        }
        return [
          createDelegateTaskTool({ config, sessionKey: ctx.sessionKey }),
          createCheckTaskStatusTool({ config, sessionKey: ctx.sessionKey }),
          createSubmitResultTool({ config, sessionKey: ctx.sessionKey }),
          createRequestReviewTool({ config, sessionKey: ctx.sessionKey }),
          createMultiAgentDebateTool({ config, sessionKey: ctx.sessionKey }),
          createHandoffToAgentTool({ config, sessionKey: ctx.sessionKey }),
        ];
      },
      {
        names: [
          "delegate_task",
          "check_task_status",
          "submit_result",
          "request_review",
          "multi_agent_debate",
          "handoff_to_agent",
        ],
      },
    );

    // Register tripwire monitor
    const tripwire = createTripwireMonitor();
    api.on("after_tool_call", async (_ctx, event) => {
      tripwire.checkUsage(event);
    });

    // Register audit trail
    const audit = createAuditTrail();
    api.on("after_tool_call", async (_ctx, event) => {
      audit.recordToolCall(event);
    });

    // Register gateway methods
    api.registerGatewayMethod("orchestration.status", async (opts) => {
      const { handleOrchestrationStatus } =
        await import("./src/gateway-methods/orchestration-status.js");
      await handleOrchestrationStatus({ params: opts.params, respond: opts.respond });
    });
    api.registerGatewayMethod("orchestration.list", async (opts) => {
      const { handleOrchestrationList } =
        await import("./src/gateway-methods/orchestration-list.js");
      await handleOrchestrationList({ params: opts.params, respond: opts.respond });
    });
    api.registerGatewayMethod("orchestration.cancel", async (opts) => {
      const { handleOrchestrationCancel } =
        await import("./src/gateway-methods/orchestration-cancel.js");
      await handleOrchestrationCancel({ params: opts.params, respond: opts.respond });
    });
  },
};

export default orchestratorPlugin;
