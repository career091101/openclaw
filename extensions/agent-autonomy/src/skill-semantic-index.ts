/**
 * Skill Semantic Indexing Utility
 *
 * Provides background indexing and semantic search for agent skills,
 * enabling intelligent skill discovery based on task descriptions.
 */

import path from "node:path";
import type { OpenClawConfig } from "../../../src/config/config.js";
import {
  indexSkills,
  searchSkillsSemantic,
  clusterSkills,
  recordSkillPattern,
  getRecommendedPatterns,
} from "../../../src/agents/skills/semantic-clustering.js";
import { loadWorkspaceSkillEntries } from "../../../src/agents/skills/workspace.js";
import { createSubsystemLogger } from "../../../src/logging/subsystem.js";
import { CONFIG_DIR } from "../../../src/utils.js";

const logger = createSubsystemLogger("skill-semantic-index");

const EMBEDDINGS_DB_NAME = "skill-embeddings.db";

/**
 * Get the path to the skill embeddings database
 */
export function getSkillEmbeddingsDbPath(): string {
  return path.join(CONFIG_DIR, "cache", EMBEDDINGS_DB_NAME);
}

/**
 * Index all available skills with semantic embeddings
 */
export async function indexAllSkills(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  forceReindex?: boolean;
}): Promise<{ indexed: number; skipped: number; errors: number }> {
  logger.info("Starting skill semantic indexing...");

  try {
    const entries = loadWorkspaceSkillEntries(params.workspaceDir, {
      config: params.config,
    });

    logger.info(`Found ${entries.length} skills to index`);

    const dbPath = getSkillEmbeddingsDbPath();
    const result = await indexSkills({
      entries,
      dbPath,
      forceReindex: params.forceReindex,
    });

    logger.info("Skill indexing complete", result);

    // Also generate clusters after indexing
    if (result.indexed > 0) {
      const clusters = await clusterSkills({ dbPath });
      logger.info(`Generated ${clusters.length} skill clusters`);
    }

    return result;
  } catch (error) {
    logger.error("Failed to index skills", { error });
    throw error;
  }
}

/**
 * Search for skills relevant to a task description
 */
export async function findRelevantSkills(params: {
  taskDescription: string;
  limit?: number;
  threshold?: number;
}): Promise<Array<{ skillName: string; score: number }>> {
  const dbPath = getSkillEmbeddingsDbPath();

  try {
    const results = await searchSkillsSemantic({
      query: params.taskDescription,
      dbPath,
      limit: params.limit ?? 10,
      threshold: params.threshold ?? 0.7,
    });

    logger.debug("Found relevant skills", {
      query: params.taskDescription,
      count: results.length,
    });

    return results;
  } catch (error) {
    logger.warn("Failed to search skills semantically", { error });
    return [];
  }
}

/**
 * Record a skill usage pattern for future recommendations
 */
export async function trackSkillPattern(params: {
  skills: string[];
  context?: string;
  success: boolean;
}): Promise<void> {
  const dbPath = getSkillEmbeddingsDbPath();

  try {
    await recordSkillPattern({
      dbPath,
      skills: params.skills,
      context: params.context,
      success: params.success,
    });

    logger.debug("Recorded skill pattern", {
      skills: params.skills.join(" -> "),
      success: params.success,
    });
  } catch (error) {
    logger.warn("Failed to record skill pattern", { error });
  }
}

/**
 * Get recommended skill patterns based on historical success
 */
export async function getSkillRecommendations(params?: {
  limit?: number;
}): Promise<Array<{ sequence: string[]; successRate: number }>> {
  const dbPath = getSkillEmbeddingsDbPath();

  try {
    const patterns = await getRecommendedPatterns({
      dbPath,
      limit: params?.limit ?? 5,
    });

    logger.debug("Retrieved skill recommendations", {
      count: patterns.length,
    });

    return patterns;
  } catch (error) {
    logger.warn("Failed to get skill recommendations", { error });
    return [];
  }
}
