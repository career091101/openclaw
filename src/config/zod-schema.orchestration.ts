import { z } from "zod";

export const OrchestrationRoleSchema = z.enum(["planner", "executor", "critic"]);

export const OrchestrationAutonomyLevelSchema = z.number().int().min(0).max(4).default(2);

export const OrchestrationTripwireSchema = z
  .object({
    maxCostUsd: z.number().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    maxDurationMinutes: z.number().positive().optional(),
  })
  .strict()
  .optional();

export const OrchestrationConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    autonomyLevel: OrchestrationAutonomyLevelSchema,
    maxConcurrentTasks: z.number().int().min(1).max(10).default(3),
    tripwire: OrchestrationTripwireSchema,
    roles: z
      .object({
        planner: z
          .object({
            model: z.string().optional(),
            autonomyLevel: OrchestrationAutonomyLevelSchema.optional(),
          })
          .strict()
          .optional(),
        executor: z
          .object({
            model: z.string().optional(),
            autonomyLevel: OrchestrationAutonomyLevelSchema.optional(),
          })
          .strict()
          .optional(),
        critic: z
          .object({
            model: z.string().optional(),
            autonomyLevel: OrchestrationAutonomyLevelSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    audit: z
      .object({
        enabled: z.boolean().default(true),
        retentionDays: z.number().int().positive().default(30),
      })
      .strict()
      .optional(),
  })
  .strict();
