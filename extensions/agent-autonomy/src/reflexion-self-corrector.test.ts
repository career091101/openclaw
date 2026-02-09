import { describe, it, expect, beforeEach } from "vitest";
import {
  ReflexionSelfCorrector,
  InMemoryFailureStorage,
  withSelfCorrection,
} from "./reflexion-self-corrector.js";

describe("ReflexionSelfCorrector", () => {
  let corrector: ReflexionSelfCorrector;
  let storage: InMemoryFailureStorage;

  beforeEach(async () => {
    storage = new InMemoryFailureStorage();
    corrector = new ReflexionSelfCorrector({
      storage,
      verbose: false,
      autoDetect: true,
      minOccurrencesForPattern: 2,
      minConfidenceForAutoCorrection: 0.5,
    });
    await corrector.initialize();
  });

  describe("Pattern Matching", () => {
    it("should match error patterns by substring", async () => {
      await corrector.addPattern({
        name: "Network timeout",
        errorPattern: "ETIMEDOUT",
        correction: { type: "retry", description: "Retry with backoff" },
        occurrences: 0,
        successfulRecoveries: 0,
        confidence: 0,
      });

      const result = await corrector.handleFailure(
        new Error("Connection ETIMEDOUT after 30s"),
        "fetch",
      );

      expect(result.shouldRetry).toBe(false); // Low confidence initially
      expect(result.pattern?.name).toBe("Network timeout");
    });

    it("should match error patterns by regex", async () => {
      await corrector.addPattern({
        name: "Rate limit",
        errorPattern: /rate limit|429/i,
        correction: { type: "retry", description: "Wait and retry" },
        occurrences: 5,
        successfulRecoveries: 4,
        confidence: 0.8,
      });

      const result = await corrector.handleFailure(
        new Error("API rate limit exceeded (429)"),
        "api_call",
      );

      expect(result.shouldRetry).toBe(true); // High confidence
      expect(result.correction?.type).toBe("retry");
    });
  });

  describe("Pattern Learning", () => {
    it("should auto-detect patterns from repeated failures", async () => {
      const error = new Error("Database connection failed");

      // First occurrence
      await corrector.handleFailure(error, "db_query");
      let patterns = corrector.getPatterns();
      expect(patterns.length).toBe(0); // Not enough occurrences yet

      // Second occurrence - should create pattern
      await corrector.handleFailure(error, "db_query");
      patterns = corrector.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].errorPattern).toBe("Database connection failed");
    });

    it("should update pattern statistics on each occurrence", async () => {
      const patternId = await corrector.addPattern({
        name: "File not found",
        errorPattern: "ENOENT",
        correction: { type: "skip", description: "Skip missing file" },
        occurrences: 1,
        successfulRecoveries: 0,
        confidence: 0,
      });

      await corrector.handleFailure(new Error("ENOENT: file not found"), "read_file");

      const patterns = corrector.getPatterns();
      const pattern = patterns.find((p) => p.id === patternId);

      expect(pattern?.occurrences).toBe(2);
    });

    it("should increase confidence after successful recovery", async () => {
      const patternId = await corrector.addPattern({
        name: "Temporary failure",
        errorPattern: "EAGAIN",
        correction: { type: "retry", description: "Retry immediately" },
        occurrences: 10,
        successfulRecoveries: 0,
        confidence: 0,
      });

      // Report success
      await corrector.reportSuccess(patternId);

      const patterns = corrector.getPatterns();
      const pattern = patterns.find((p) => p.id === patternId);

      expect(pattern?.successfulRecoveries).toBe(1);
      expect(pattern?.confidence).toBe(0.1); // 1/10
    });
  });

  describe("Self-Correction", () => {
    it("should suggest retry for high-confidence patterns", async () => {
      await corrector.addPattern({
        name: "Transient error",
        errorPattern: "ECONNRESET",
        correction: { type: "retry", description: "Network retry" },
        occurrences: 20,
        successfulRecoveries: 18,
        confidence: 0.9,
      });

      const result = await corrector.handleFailure(
        new Error("ECONNRESET: connection reset"),
        "network_op",
      );

      expect(result.shouldRetry).toBe(true);
      expect(result.correction?.type).toBe("retry");
    });

    it("should not auto-correct low-confidence patterns", async () => {
      await corrector.addPattern({
        name: "Unknown error",
        errorPattern: "Unknown",
        correction: { type: "retry", description: "Try again" },
        occurrences: 10,
        successfulRecoveries: 2,
        confidence: 0.2,
      });

      const result = await corrector.handleFailure(
        new Error("Unknown error occurred"),
        "operation",
      );

      expect(result.shouldRetry).toBe(false); // Below threshold
    });
  });

  describe("Context Sanitization", () => {
    it("should redact sensitive context data", async () => {
      await corrector.handleFailure(new Error("Auth failed"), "authenticate", {
        username: "user@example.com",
        password: "secret123",
        apiKey: "sk-1234567890",
      });

      const records = await corrector.getRecentFailures(1);

      expect(records[0].context?.username).toBe("user@example.com");
      expect(records[0].context?.password).toBe("[REDACTED]");
      expect(records[0].context?.apiKey).toBe("[REDACTED]");
    });
  });

  describe("withSelfCorrection helper", () => {
    it("should retry on failure with matching pattern", async () => {
      await corrector.addPattern({
        name: "Flaky test",
        errorPattern: "Flaky",
        correction: { type: "retry", description: "Retry flaky operation" },
        occurrences: 10,
        successfulRecoveries: 9,
        confidence: 0.9,
      });

      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Flaky error");
        }
        return "success";
      };

      const result = await withSelfCorrection(corrector, "test_op", fn, {}, 3);

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });

    it("should give up after max retries", async () => {
      await corrector.addPattern({
        name: "Persistent error",
        errorPattern: "Always fails",
        correction: { type: "retry", description: "Retry anyway" },
        occurrences: 10,
        successfulRecoveries: 9,
        confidence: 0.9,
      });

      const fn = async () => {
        throw new Error("Always fails");
      };

      await expect(withSelfCorrection(corrector, "failing_op", fn, {}, 2)).rejects.toThrow(
        "Always fails",
      );
    });
  });

  describe("Storage", () => {
    it("should persist patterns across instances", async () => {
      await corrector.addPattern({
        name: "Saved pattern",
        errorPattern: "SavedError",
        correction: { type: "skip", description: "Skip it" },
        occurrences: 5,
        successfulRecoveries: 0,
        confidence: 0,
      });

      // Create new instance with same storage
      const corrector2 = new ReflexionSelfCorrector({ storage });
      await corrector2.initialize();

      const patterns = corrector2.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].name).toBe("Saved pattern");
    });
  });
});
