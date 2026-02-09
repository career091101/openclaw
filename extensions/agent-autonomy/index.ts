import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import type { MemorySearchFn } from "./src/jit-context.js";
import { createJitContextInjector } from "./src/jit-context.js";
import { createRetryWrapper } from "./src/retry-wrapper.js";
import { createStructuredCompaction } from "./src/structured-compaction.js";
import { createToolResultValidator } from "./src/tool-result-validator.js";

const agentAutonomyPlugin = {
  id: "agent-autonomy",
  name: "Agent Autonomy",
  description:
    "Memory write-back, self-correction loops, structured compaction, and JIT context injection",
  kind: "agent",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // Register memory write-back tools
    api.registerTool(
      (ctx) => {
        const writeTool = api.runtime.tools.createMemoryWriteTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const updateTool = api.runtime.tools.createMemoryUpdateTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const forgetTool = api.runtime.tools.createMemoryForgetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const tools = [writeTool, updateTool, forgetTool].filter(
          (t): t is NonNullable<typeof t> => t != null,
        );
        return tools.length > 0 ? tools : null;
      },
      { names: ["memory_write", "memory_update", "memory_forget"] },
    );

    // Register tool result validation hook
    const validator = createToolResultValidator();
    api.on("after_tool_call", async (_ctx, event) => {
      validator.validate(event);
    });

    // Register retry context injection hook
    const retryWrapper = createRetryWrapper();
    api.on("before_agent_start", async () => {
      return retryWrapper.injectRetryContext();
    });

    // Register JIT context injection hook
    const jitContext = createJitContextInjector();
    api.on("before_agent_start", async (ctx, event) => {
      // Build searchFn dynamically using the runtime memory search manager
      const searchFn: MemorySearchFn = async (query, opts) => {
        const agentId = ctx.agentId ?? "coder";
        const cfg = api.runtime.config.loadConfig();
        const { manager } = await api.runtime.tools.getMemorySearchManager({
          cfg,
          agentId,
        });
        if (!manager) {
          return [];
        }
        const results = await manager.search(query, opts);
        return results ?? [];
      };
      return await jitContext.inject(event, searchFn);
    });

    // Register structured compaction hooks
    const compaction = createStructuredCompaction();
    api.on("before_compaction", async (_ctx, event) => {
      compaction.beforeCompaction(event);
    });
    api.on("after_compaction", async (_ctx, event) => {
      compaction.afterCompaction(event);
    });
  },
};

export default agentAutonomyPlugin;
