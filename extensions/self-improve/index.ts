import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { isAllowedPath, isAllowedCommand, getPathBlockReason } from "./src/scope-guard.js";
import { createCheckImproveStatusTool } from "./src/tools/check-improve-status.js";
import { createEvaluateTipTool } from "./src/tools/evaluate-tip.js";
import { createRecordTipTool } from "./src/tools/record-tip.js";

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

  if (agentId && Array.isArray(list)) {
    const entry = list.find(
      (a) => typeof a.id === "string" && a.id.toLowerCase() === agentId.toLowerCase(),
    );
    if (entry?.[key] && typeof entry[key] === "object") {
      return entry[key] as Record<string, unknown>;
    }
  }

  if (defaults?.[key] && typeof defaults[key] === "object") {
    return defaults[key] as Record<string, unknown>;
  }
  return undefined;
}

const selfImprovePlugin = {
  id: "self-improve",
  name: "Self-Improve",
  description:
    "Automated self-improvement loop: research, evaluate, implement, and PR autonomy tips",
  kind: "agent",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // Register self-improve tools
    api.registerTool(
      (ctx) => {
        const config = ctx.config;
        const selfImprove = resolveAgentFeature(config, ctx.agentId, "selfImprove");
        if (!selfImprove?.enabled) {
          return null;
        }
        return [
          createEvaluateTipTool({ config, sessionKey: ctx.sessionKey }),
          createRecordTipTool({ config, sessionKey: ctx.sessionKey }),
          createCheckImproveStatusTool({ config, sessionKey: ctx.sessionKey }),
        ];
      },
      { names: ["evaluate_tip", "record_tip", "check_improve_status"] },
    );

    // Scope guard: block file modifications outside allowed paths
    api.on("before_tool_call", async (_ctx, event) => {
      const toolName = typeof event.toolName === "string" ? event.toolName : "";
      const params = (event.params ?? {}) as Record<string, unknown>;

      // Check file path restrictions for write/edit tools
      if (toolName === "write" || toolName === "edit" || toolName === "create_file") {
        const filePath = typeof params.file_path === "string" ? params.file_path : "";
        if (filePath && !isAllowedPath(filePath)) {
          return {
            block: true,
            blockReason: `Self-improve scope guard: ${getPathBlockReason(filePath)}`,
          };
        }
      }

      // Check command restrictions for exec/bash tools
      if (toolName === "bash" || toolName === "exec") {
        const command = typeof params.command === "string" ? params.command : "";
        if (command && !isAllowedCommand(command)) {
          return {
            block: true,
            blockReason: `Self-improve scope guard: forbidden command detected`,
          };
        }
      }

      return undefined;
    });

    // Register gateway methods
    api.registerGatewayMethod("improve.status", async (opts) => {
      const { handleImproveStatus } = await import("./src/gateway-methods/improve-status.js");
      await handleImproveStatus({ params: opts.params, respond: opts.respond });
    });
    api.registerGatewayMethod("improve.history", async (opts) => {
      const { handleImproveHistory } = await import("./src/gateway-methods/improve-history.js");
      await handleImproveHistory({ params: opts.params, respond: opts.respond });
    });
    api.registerGatewayMethod("improve.run", async (opts) => {
      const { handleImproveRun } =
        await import("./src/gateway-methods/improve-run.js");
      await handleImproveRun({ params: opts.params, respond: opts.respond, context: opts.context });
    });
    api.registerGatewayMethod("improve.schedule", async (opts) => {
      const { handleImproveSchedule } =
        await import("./src/gateway-methods/improve-schedule.js");
      await handleImproveSchedule({ params: opts.params, respond: opts.respond, context: opts.context });
    });

    // Register CLI commands
    api.registerCli(
      async ({ program }) => {
        const improve = program.command("improve").description("Self-improvement loop");

        improve
          .command("run")
          .description("Trigger a self-improvement run")
          .option("--dry-run", "Research only, no implementation")
          .option("--tip <id>", "Target a specific tip by ID")
          .option("--max-tips <n>", "Max tips to research", "10")
          .option("--url <url>", "Gateway WebSocket URL")
          .option("--token <token>", "Gateway token")
          .option("--timeout <ms>", "Timeout in ms", "30000")
          .action(async (opts: Record<string, string | boolean | undefined>) => {
            const { callGateway } = await import("openclaw/gateway/call");
            try {
              const result = await callGateway({
                url: typeof opts.url === "string" ? opts.url : undefined,
                token: typeof opts.token === "string" ? opts.token : undefined,
                method: "improve.run",
                params: {
                  dryRun: opts.dryRun === true,
                  tipId: typeof opts.tip === "string" ? opts.tip : undefined,
                  maxTips: typeof opts.maxTips === "string" ? Number(opts.maxTips) : 10,
                },
                timeoutMs: Number(opts.timeout ?? 30000),
              });
              console.log(JSON.stringify(result, null, 2));
            } catch (err) {
              console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
              process.exitCode = 1;
            }
          });

        improve
          .command("status")
          .description("Show self-improvement status")
          .option("--url <url>", "Gateway WebSocket URL")
          .option("--token <token>", "Gateway token")
          .option("--timeout <ms>", "Timeout in ms", "10000")
          .action(async (opts: Record<string, string | undefined>) => {
            const { callGateway } = await import("openclaw/gateway/call");
            try {
              const result = await callGateway({
                url: typeof opts.url === "string" ? opts.url : undefined,
                token: typeof opts.token === "string" ? opts.token : undefined,
                method: "improve.status",
                params: {},
                timeoutMs: Number(opts.timeout ?? 10000),
              });
              console.log(JSON.stringify(result, null, 2));
            } catch (err) {
              console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
              process.exitCode = 1;
            }
          });

        improve
          .command("history")
          .description("Show self-improvement history")
          .option("--limit <n>", "Number of entries", "20")
          .option("--tips", "Include tip details")
          .option("--status <status>", "Filter by tip status")
          .option("--url <url>", "Gateway WebSocket URL")
          .option("--token <token>", "Gateway token")
          .option("--timeout <ms>", "Timeout in ms", "10000")
          .action(async (opts: Record<string, string | boolean | undefined>) => {
            const { callGateway } = await import("openclaw/gateway/call");
            try {
              const result = await callGateway({
                url: typeof opts.url === "string" ? opts.url : undefined,
                token: typeof opts.token === "string" ? opts.token : undefined,
                method: "improve.history",
                params: {
                  limit: typeof opts.limit === "string" ? Number(opts.limit) : 20,
                  includeTips: opts.tips === true,
                  status: typeof opts.status === "string" ? opts.status : undefined,
                },
                timeoutMs: Number(opts.timeout ?? 10000),
              });
              console.log(JSON.stringify(result, null, 2));
            } catch (err) {
              console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
              process.exitCode = 1;
            }
          });

        improve
          .command("schedule")
          .description("Manage self-improvement schedule")
          .option("--set <cron>", "Set a custom cron expression")
          .option("--enable", "Enable with default schedule")
          .option("--disable", "Disable automatic runs")
          .option("--remove", "Remove the schedule entirely")
          .option("--url <url>", "Gateway WebSocket URL")
          .option("--token <token>", "Gateway token")
          .option("--timeout <ms>", "Timeout in ms", "10000")
          .action(async (opts: Record<string, string | boolean | undefined>) => {
            const { callGateway } = await import("openclaw/gateway/call");
            const action = opts.remove === true
              ? "remove"
              : opts.disable === true
                ? "disable"
                : opts.enable === true || typeof opts.set === "string"
                  ? "enable"
                  : "status";
            try {
              const result = await callGateway({
                url: typeof opts.url === "string" ? opts.url : undefined,
                token: typeof opts.token === "string" ? opts.token : undefined,
                method: "improve.schedule",
                params: {
                  action,
                  cronExpr: typeof opts.set === "string" ? opts.set : undefined,
                },
                timeoutMs: Number(opts.timeout ?? 10000),
              });
              console.log(JSON.stringify(result, null, 2));
            } catch (err) {
              console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
              process.exitCode = 1;
            }
          });
      },
      { commands: ["improve"] },
    );
  },
};

export default selfImprovePlugin;
