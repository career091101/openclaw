import { describe, it, expect, beforeEach } from "vitest";
import {
  InterpretabilityLogger,
  InMemoryDecisionStorage,
  createToolRationale,
  withDecisionLogging,
  type ToolSelectionRationale,
} from "./interpretability-logger.js";

describe("InterpretabilityLogger", () => {
  let logger: InterpretabilityLogger;
  let storage: InMemoryDecisionStorage;

  beforeEach(() => {
    storage = new InMemoryDecisionStorage();
    logger = new InterpretabilityLogger({
      storage,
      verbose: false,
    });
  });

  describe("logDecision", () => {
    it("should log a decision and return a decision ID", async () => {
      const decisionId = await logger.logDecision({
        type: "tool_selection",
        description: "Select read tool",
        choice: "read",
        rationale: "Need to read file contents",
        confidence: 0.9,
      });

      expect(decisionId).toMatch(/^decision_/);

      const decisions = await logger.getRecentDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0].choice).toBe("read");
      expect(decisions[0].confidence).toBe(0.9);
      expect(decisions[0].confidenceLevel).toBe("high");
    });

    it("should categorize confidence levels correctly", async () => {
      await logger.logDecision({
        type: "tool_selection",
        description: "High confidence",
        choice: "option_a",
        rationale: "Clear choice",
        confidence: 0.85,
      });

      await logger.logDecision({
        type: "tool_selection",
        description: "Medium confidence",
        choice: "option_b",
        rationale: "Reasonable choice",
        confidence: 0.65,
      });

      await logger.logDecision({
        type: "tool_selection",
        description: "Low confidence",
        choice: "option_c",
        rationale: "Uncertain",
        confidence: 0.4,
      });

      const decisions = await logger.getRecentDecisions();
      expect(decisions[0].confidenceLevel).toBe("high");
      expect(decisions[1].confidenceLevel).toBe("medium");
      expect(decisions[2].confidenceLevel).toBe("low");
    });

    it("should skip logging when disabled", async () => {
      const disabledLogger = new InterpretabilityLogger({
        storage,
        enabled: false,
      });

      const decisionId = await disabledLogger.logDecision({
        type: "tool_selection",
        description: "Test",
        choice: "test",
        rationale: "Test rationale",
        confidence: 0.9,
      });

      expect(decisionId).toBe("disabled");

      const decisions = await disabledLogger.getRecentDecisions();
      expect(decisions).toHaveLength(0);
    });

    it("should skip logging below confidence threshold", async () => {
      const thresholdLogger = new InterpretabilityLogger({
        storage,
        minConfidenceToLog: 0.5,
      });

      const decisionId = await thresholdLogger.logDecision({
        type: "tool_selection",
        description: "Low confidence decision",
        choice: "option",
        rationale: "Uncertain",
        confidence: 0.3,
      });

      expect(decisionId).toBe("skipped_low_confidence");

      const decisions = await thresholdLogger.getRecentDecisions();
      expect(decisions).toHaveLength(0);
    });

    it("should include alternatives and influencing factors", async () => {
      await logger.logDecision({
        type: "strategy_selection",
        description: "Choose execution strategy",
        choice: "parallel",
        alternatives: ["sequential", "batched"],
        rationale: "Parallel execution will be faster",
        confidence: 0.8,
        influencingFactors: [
          {
            name: "independence",
            weight: 0.8,
            description: "Operations are independent",
          },
          {
            name: "resource_availability",
            weight: 0.6,
            description: "Sufficient resources for parallel execution",
          },
        ],
      });

      const decisions = await logger.getRecentDecisions();
      expect(decisions[0].alternatives).toEqual(["sequential", "batched"]);
      expect(decisions[0].influencingFactors).toHaveLength(2);
      expect(decisions[0].influencingFactors![0].weight).toBe(0.8);
    });
  });

  describe("logToolSelection", () => {
    it("should log tool selection with rationale", async () => {
      const rationale: ToolSelectionRationale = {
        selectedTool: "exec",
        reason: "Need to run shell command",
        confidence: 0.85,
        expectedOutcome: "Command output",
        rejectedTools: [
          { tool: "read", reason: "Cannot execute commands" },
          { tool: "write", reason: "Not suitable for execution" },
        ],
        parameterRationale: {
          command: "Selected git status to check repository state",
          workdir: "Using current directory as context",
        },
      };

      await logger.logToolSelection(rationale, "session_123");

      const decisions = await logger.getRecentDecisions("session_123");
      expect(decisions).toHaveLength(1);
      expect(decisions[0].type).toBe("tool_selection");
      expect(decisions[0].choice).toBe("exec");
      expect(decisions[0].alternatives).toEqual(["read", "write"]);
      expect(decisions[0].contextId).toBe("session_123");
      expect(decisions[0].metadata).toBeDefined();
      expect(decisions[0].metadata!.expectedOutcome).toBe("Command output");
    });
  });

  describe("recordOutcome", () => {
    it("should record successful outcome", async () => {
      const decisionId = await logger.logDecision({
        type: "tool_selection",
        description: "Test decision",
        choice: "test_tool",
        rationale: "Test rationale",
        confidence: 0.9,
      });

      await logger.recordOutcome(decisionId, {
        success: true,
        executionTimeMs: 150,
        result: { data: "test result" },
      });

      const decision = await storage.getDecisionById(decisionId);
      expect(decision).toBeDefined();
      expect(decision!.outcome).toBeDefined();
      expect(decision!.outcome!.success).toBe(true);
      expect(decision!.outcome!.executionTimeMs).toBe(150);
    });

    it("should record failed outcome with error", async () => {
      const decisionId = await logger.logDecision({
        type: "tool_selection",
        description: "Test decision",
        choice: "test_tool",
        rationale: "Test rationale",
        confidence: 0.7,
      });

      await logger.recordOutcome(decisionId, {
        success: false,
        executionTimeMs: 100,
        error: "Tool execution failed",
        reflection: "Should have chosen alternative tool",
      });

      const decision = await storage.getDecisionById(decisionId);
      expect(decision!.outcome!.success).toBe(false);
      expect(decision!.outcome!.error).toBe("Tool execution failed");
      expect(decision!.outcome!.reflection).toBe("Should have chosen alternative tool");
    });
  });

  describe("queryDecisions", () => {
    beforeEach(async () => {
      // Log various decisions
      await logger.logDecision({
        type: "tool_selection",
        description: "High confidence tool",
        choice: "read",
        rationale: "Clear choice",
        confidence: 0.9,
      });

      await logger.logDecision({
        type: "strategy_selection",
        description: "Medium confidence strategy",
        choice: "parallel",
        rationale: "Should work",
        confidence: 0.6,
      });

      await logger.logDecision({
        type: "error_recovery",
        description: "Low confidence recovery",
        choice: "retry",
        rationale: "Uncertain",
        confidence: 0.4,
      });
    });

    it("should query by confidence level", async () => {
      const lowConfidence = await logger.getDecisionsByConfidence("low");
      expect(lowConfidence).toHaveLength(1);
      expect(lowConfidence[0].confidenceLevel).toBe("low");

      const highConfidence = await logger.getDecisionsByConfidence("high");
      expect(highConfidence).toHaveLength(1);
      expect(highConfidence[0].confidenceLevel).toBe("high");
    });

    it("should query by decision type", async () => {
      const toolSelections = await logger.getDecisionsByType("tool_selection");
      expect(toolSelections).toHaveLength(1);
      expect(toolSelections[0].type).toBe("tool_selection");

      const strategies = await logger.getDecisionsByType("strategy_selection");
      expect(strategies).toHaveLength(1);
      expect(strategies[0].type).toBe("strategy_selection");
    });
  });

  describe("analyzeDecisionPatterns", () => {
    beforeEach(async () => {
      // Create test decisions with outcomes
      const decision1 = await logger.logDecision({
        type: "tool_selection",
        description: "Test 1",
        choice: "tool_a",
        rationale: "Rationale 1",
        confidence: 0.9,
      });
      await logger.recordOutcome(decision1, { success: true, executionTimeMs: 100 });

      const decision2 = await logger.logDecision({
        type: "tool_selection",
        description: "Test 2",
        choice: "tool_b",
        rationale: "Rationale 2",
        confidence: 0.4,
      });
      await logger.recordOutcome(decision2, {
        success: false,
        executionTimeMs: 50,
        error: "Failed",
      });

      await logger.logDecision({
        type: "strategy_selection",
        description: "Test 3",
        choice: "strategy_a",
        rationale: "Rationale 3",
        confidence: 0.7,
      });
    });

    it("should analyze decision patterns", async () => {
      const analysis = await logger.analyzeDecisionPatterns();

      expect(analysis.totalDecisions).toBe(3);
      expect(analysis.lowConfidenceCount).toBe(1);
      expect(analysis.lowConfidenceRate).toBeCloseTo(0.333, 2);
      expect(analysis.failedDecisions).toBe(1);
      expect(analysis.avgConfidence).toBeCloseTo(0.667, 2);
      expect(analysis.typeDistribution["tool_selection"]).toBe(2);
      expect(analysis.typeDistribution["strategy_selection"]).toBe(1);
    });

    it("should generate recommendations", async () => {
      // Add more low confidence decisions to trigger recommendation
      for (let i = 0; i < 5; i++) {
        await logger.logDecision({
          type: "tool_selection",
          description: `Low conf ${i}`,
          choice: "tool",
          rationale: "Uncertain",
          confidence: 0.3,
        });
      }

      const analysis = await logger.analyzeDecisionPatterns();
      expect(analysis.recommendations.length).toBeGreaterThan(0);
      expect(analysis.recommendations.some((r) => r.includes("low-confidence"))).toBe(true);
    });
  });

  describe("helper functions", () => {
    it("createToolRationale should create valid rationale", () => {
      const rationale = createToolRationale(
        "exec",
        "Need to execute command",
        0.85,
        "Command output",
        [{ tool: "read", reason: "Cannot execute" }],
        { command: "git status" },
      );

      expect(rationale.selectedTool).toBe("exec");
      expect(rationale.confidence).toBe(0.85);
      expect(rationale.rejectedTools).toHaveLength(1);
      expect(rationale.parameterRationale).toHaveProperty("command");
    });

    it("withDecisionLogging should log decision and outcome", async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "success";
      };

      const { result, decisionId } = await withDecisionLogging(
        logger,
        {
          type: "tool_selection",
          description: "Test operation",
          choice: "test",
          rationale: "Testing",
          confidence: 0.8,
        },
        operation,
      );

      expect(result).toBe("success");
      expect(decisionId).toMatch(/^decision_/);

      const decision = await storage.getDecisionById(decisionId);
      expect(decision!.outcome).toBeDefined();
      expect(decision!.outcome!.success).toBe(true);
      expect(decision!.outcome!.executionTimeMs).toBeGreaterThanOrEqual(50);
    });

    it("withDecisionLogging should record failure", async () => {
      const operation = async () => {
        throw new Error("Operation failed");
      };

      await expect(
        withDecisionLogging(
          logger,
          {
            type: "tool_selection",
            description: "Failing operation",
            choice: "test",
            rationale: "Testing failure",
            confidence: 0.6,
          },
          operation,
        ),
      ).rejects.toThrow("Operation failed");

      const decisions = await logger.getRecentDecisions();
      expect(decisions[0].outcome).toBeDefined();
      expect(decisions[0].outcome!.success).toBe(false);
      expect(decisions[0].outcome!.error).toBe("Operation failed");
    });
  });

  describe("InMemoryDecisionStorage", () => {
    it("should handle context-based filtering", async () => {
      await storage.saveDecision({
        id: "d1",
        type: "tool_selection",
        timestamp: Date.now(),
        contextId: "ctx_1",
        description: "Decision 1",
        choice: "choice_1",
        rationale: "Rationale 1",
        confidence: 0.8,
        confidenceLevel: "high",
      });

      await storage.saveDecision({
        id: "d2",
        type: "tool_selection",
        timestamp: Date.now(),
        contextId: "ctx_2",
        description: "Decision 2",
        choice: "choice_2",
        rationale: "Rationale 2",
        confidence: 0.7,
        confidenceLevel: "medium",
      });

      const ctx1Decisions = await storage.loadDecisions("ctx_1");
      expect(ctx1Decisions).toHaveLength(1);
      expect(ctx1Decisions[0].id).toBe("d1");

      const ctx2Decisions = await storage.loadDecisions("ctx_2");
      expect(ctx2Decisions).toHaveLength(1);
      expect(ctx2Decisions[0].id).toBe("d2");
    });

    it("should enforce memory limits", async () => {
      // Add more than max to test cleanup
      for (let i = 0; i < 5500; i++) {
        await storage.saveDecision({
          id: `d${i}`,
          type: "tool_selection",
          timestamp: Date.now() + i,
          description: `Decision ${i}`,
          choice: `choice_${i}`,
          rationale: "Test",
          confidence: 0.8,
          confidenceLevel: "high",
        });
      }

      const allDecisions = storage.getAllDecisions();
      expect(allDecisions.length).toBeLessThanOrEqual(5000);
    });
  });
});
