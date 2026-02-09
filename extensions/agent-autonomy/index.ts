import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import type { MemorySearchFn } from "./src/jit-context.js";
import { classifyError } from "./src/error-classifier.js";
import { createConfidenceEscalation } from "./src/confidence-escalation.js";
import { recordToolSuccess } from "./src/few-shot-examples.js";
import { createJitContextInjector } from "./src/jit-context.js";
import { createRetryWrapper } from "./src/retry-wrapper.js";
import { createStructuredCompaction } from "./src/structured-compaction.js";
import { createToolAnalyticsTracker } from "./src/tool-analytics.js";
import { createToolResultValidator } from "./src/tool-result-validator.js";

// Tool rehearsal module is available but not yet integrated into the plugin hooks
// import {
//   rehearseToolOperation,
//   isDestructiveOperation,
//   formatRehearsalSummary,
// } from "./src/tool-rehearsal.js";

// Export continuous loop utilities for programmatic use
export {
  continuousLoop,
  retryUntilSuccess,
  iterationCountIs,
  tokenCountIs,
  costIs,
  type ContinuousLoopOptions,
  type ExecuteFunction,
  type VerificationResult,
  type LoopResult,
  type StopCondition,
} from "./src/continuous-loop.js";

// Export few-shot example utilities for programmatic use
export {
  calculateToolSimilarity,
  ToolExampleStore,
  formatExamplesForPrompt,
  getGlobalToolExampleStore,
  recordToolSuccess,
  getFewShotExamples,
  type ToolCallExample,
  type FewShotConfig,
  type SimilarityMetric,
} from "./src/few-shot-examples.js";

// Export confidence escalation utilities for programmatic use
export {
  createConfidenceEscalation,
  type ConfidenceEscalation,
  type ConfidenceScore,
  type ConfidenceState,
} from "./src/confidence-escalation.js";

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

    // Register tool analytics tracker
    const analyticsTracker = createToolAnalyticsTracker();

    // Register tool result validation hook
    const validator = createToolResultValidator();
    const confidenceEscalation = createConfidenceEscalation();

    api.on("after_tool_call", async (ctx, event) => {
      // Record analytics
      const startTime = event.startTimeMs ?? Date.now();
      const endTime = Date.now();
      const executionTimeMs = endTime - startTime;

      const success = !event.isError;
      const errorCategory =
        event.isError && event.content ? classifyError(String(event.content)).category : undefined;

      analyticsTracker.recordExecution({
        toolName: event.toolName ?? "unknown",
        success,
        executionTimeMs,
        errorCategory,
      });

      // Validate
      const validationResult = validator.validate(event);

      // Record confidence score for escalation tracking
      if (validationResult) {
        confidenceEscalation.recordConfidence({
          toolName: event.toolName,
          toolCallId: event.toolCallId ?? `${event.toolName}_${Date.now()}`,
          confidence: validationResult.confidence,
          sessionKey: ctx.sessionKey,
        });
      }

      // Auto-record successful tool calls for few-shot learning
      if (event.result && !event.error) {
        recordToolSuccess(
          event.toolName,
          event.parameters as Record<string, unknown>,
          event.result,
          event.context,
        );
      }
    });

    // Register retry context injection hook
    const retryWrapper = createRetryWrapper();
    api.on("before_agent_start", async (ctx) => {
      const retryContext = retryWrapper.injectRetryContext();
      const escalationWarning = confidenceEscalation.injectEscalationWarning(ctx.sessionKey);

      // Combine contexts if both exist
      if (retryContext && escalationWarning) {
        return {
          prependContext: retryContext.prependContext + escalationWarning.prependContext,
        };
      }

      return retryContext ?? escalationWarning;
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

    // Register tool analytics recommendations hook
    api.on("before_agent_start", async (_ctx, _event) => {
      // Get all tracked tools
      const allAnalytics = analyticsTracker.getAllAnalytics();
      if (allAnalytics.length === 0) {
        return undefined;
      }

      // Extract tool names
      const toolNames = allAnalytics.map((a) => a.toolName);

      // Get recommendations
      const recommendations = analyticsTracker.getRecommendations(toolNames);
      if (!recommendations) {
        return undefined;
      }

      return { prependContext: recommendations };
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
