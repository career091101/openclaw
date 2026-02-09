/**
 * Semantic Skill Clustering for Reusable Agent Patterns
 *
 * This module provides semantic search capabilities for agent skills,
 * enabling the system to dynamically discover relevant skills based on
 * task descriptions rather than relying solely on keyword matching.
 *
 * Based on research: https://arxiv.org/abs/2402.17782
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import type { SkillEntry } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "../../memory/embeddings.js";
import { hashText } from "../../memory/internal.js";
import { loadSqliteVecExtension } from "../../memory/sqlite-vec.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";

const logger = createSubsystemLogger("skill-clustering");

type SkillEmbedding = {
  skillName: string;
  description: string;
  embedding: Float32Array;
  hash: string;
};

type SkillCluster = {
  id: string;
  name: string;
  skills: string[];
  centroid?: Float32Array;
};

type SemanticSkillMatch = {
  skillName: string;
  score: number;
  cluster?: string;
};

const SKILL_INDEX_DB = "skill-embeddings.db";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;
const SIMILARITY_THRESHOLD = 0.7;

/**
 * Initialize the skill embeddings database
 */
async function initSkillEmbeddingsDb(dbPath: string): Promise<DatabaseSync> {
  const sqlite = requireNodeSqlite();
  const db = new sqlite.DatabaseSync(dbPath);

  // Load sqlite-vec extension for vector operations
  await loadSqliteVecExtension({ db });

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_embeddings (
      skill_name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS skill_clusters (
      cluster_id TEXT PRIMARY KEY,
      cluster_name TEXT NOT NULL,
      skills TEXT NOT NULL,
      centroid BLOB,
      updated_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS skill_patterns (
      pattern_id TEXT PRIMARY KEY,
      skill_sequence TEXT NOT NULL,
      context TEXT,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_used INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_clusters_name ON skill_clusters(cluster_name);
    CREATE INDEX IF NOT EXISTS idx_patterns_success ON skill_patterns(success_count DESC);
  `);

  return db;
}

/**
 * Generate semantic content for a skill
 */
function generateSkillSemanticContent(entry: SkillEntry): string {
  const parts: string[] = [];

  // Skill name and description
  parts.push(`Skill: ${entry.skill.name}`);
  if (entry.skill.description) {
    parts.push(`Description: ${entry.skill.description}`);
  }

  // Primary environment
  if (entry.metadata?.primaryEnv) {
    parts.push(`Environment: ${entry.metadata.primaryEnv}`);
  }

  // Extract key sections from skill content (first 500 chars)
  if (entry.skill.description && entry.skill.description.length > 100) {
    const excerpt = entry.skill.description.slice(0, 500);
    parts.push(`Content: ${excerpt}`);
  }

  return parts.join("\n");
}

/**
 * Index skills with semantic embeddings
 */
export async function indexSkills(params: {
  entries: SkillEntry[];
  dbPath: string;
  embeddingProvider?: EmbeddingProvider;
  forceReindex?: boolean;
}): Promise<{ indexed: number; skipped: number; errors: number }> {
  const db = await initSkillEmbeddingsDb(params.dbPath);

  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // If no embedding provider is given, we can't index
    if (!params.embeddingProvider) {
      logger.warn("No embedding provider provided for skill indexing");
      return { indexed: 0, skipped: params.entries.length, errors: 0 };
    }

    const provider = params.embeddingProvider;

    for (const entry of params.entries) {
      try {
        const content = generateSkillSemanticContent(entry);
        const contentHash = hashText(content);

        // Check if already indexed with same content
        if (!params.forceReindex) {
          const existing = db
            .prepare("SELECT content_hash FROM skill_embeddings WHERE skill_name = ?")
            .get(entry.skill.name) as { content_hash: string } | undefined;

          if (existing && existing.content_hash === contentHash) {
            skipped++;
            continue;
          }
        }

        // Generate embedding using the provider's embedQuery method
        const embeddingArray = await provider.embedQuery(content);
        const embedding = new Float32Array(embeddingArray);
        const embeddingBlob = Buffer.from(embedding.buffer);

        // Store in database
        db.prepare(`
          INSERT OR REPLACE INTO skill_embeddings 
          (skill_name, description, content_hash, embedding, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          entry.skill.name,
          entry.skill.description || "",
          contentHash,
          embeddingBlob,
          Date.now(),
        );

        indexed++;
      } catch (error) {
        logger.error(`Error indexing skill ${entry.skill.name}:`, { error });
        errors++;
      }
    }
  } finally {
    db.close();
  }

  return { indexed, skipped, errors };
}

/**
 * Search for skills semantically similar to a task description
 */
export async function searchSkillsSemantic(params: {
  query: string;
  dbPath: string;
  embeddingProvider?: EmbeddingProvider;
  limit?: number;
  threshold?: number;
}): Promise<SemanticSkillMatch[]> {
  const db = await initSkillEmbeddingsDb(params.dbPath);

  const limit = params.limit ?? 10;
  const threshold = params.threshold ?? SIMILARITY_THRESHOLD;

  try {
    // If no embedding provider is given, we can't search
    if (!params.embeddingProvider) {
      logger.warn("No embedding provider provided for skill search");
      return [];
    }

    const provider = params.embeddingProvider;

    // Generate query embedding using the provider's embedQuery method
    const embeddingArray = await provider.embedQuery(params.query);
    const queryEmbedding = new Float32Array(embeddingArray);
    const queryBlob = Buffer.from(queryEmbedding.buffer);

    // Search using cosine similarity
    // Note: sqlite-vec provides vec_distance_cosine function
    const rows = db
      .prepare(`
      SELECT 
        skill_name,
        description,
        (1 - vec_distance_cosine(embedding, ?)) as similarity
      FROM skill_embeddings
      WHERE similarity >= ?
      ORDER BY similarity DESC
      LIMIT ?
    `)
      .all(queryBlob, threshold, limit) as Array<{
      skill_name: string;
      description: string;
      similarity: number;
    }>;

    return rows.map((row) => ({
      skillName: row.skill_name,
      score: row.similarity,
    }));
  } finally {
    db.close();
  }
}

/**
 * Cluster skills by semantic similarity
 */
export async function clusterSkills(params: {
  dbPath: string;
  minClusterSize?: number;
  maxClusters?: number;
}): Promise<SkillCluster[]> {
  const db = await initSkillEmbeddingsDb(params.dbPath);
  const minSize = params.minClusterSize ?? 3;
  const maxClusters = params.maxClusters ?? 10;

  try {
    // Simple clustering: group skills with high cosine similarity
    // This is a basic implementation; more sophisticated clustering (k-means, DBSCAN)
    // could be added later

    const skills = db
      .prepare(`
      SELECT skill_name, description, embedding
      FROM skill_embeddings
      ORDER BY skill_name
    `)
      .all() as Array<{
      skill_name: string;
      description: string;
      embedding: Buffer;
    }>;

    if (skills.length === 0) {
      return [];
    }

    const clusters: SkillCluster[] = [];
    const assigned = new Set<string>();

    // Greedy clustering: pick a skill, find all similar skills, form a cluster
    for (const seed of skills) {
      if (assigned.has(seed.skill_name)) continue;

      const seedEmbedding = new Float32Array(seed.embedding.buffer);
      const cluster: string[] = [seed.skill_name];
      assigned.add(seed.skill_name);

      // Find similar skills
      for (const candidate of skills) {
        if (assigned.has(candidate.skill_name)) continue;

        const candidateEmbedding = new Float32Array(candidate.embedding.buffer);
        const similarity = cosineSimilarity(seedEmbedding, candidateEmbedding);

        if (similarity >= 0.8) {
          // High similarity threshold for clustering
          cluster.push(candidate.skill_name);
          assigned.add(candidate.skill_name);
        }
      }

      // Only create cluster if it meets minimum size
      if (cluster.length >= minSize) {
        clusters.push({
          id: `cluster-${clusters.length + 1}`,
          name: inferClusterName(cluster, seed.description),
          skills: cluster,
        });

        if (clusters.length >= maxClusters) break;
      }
    }

    // Store clusters
    const now = Date.now();
    for (const cluster of clusters) {
      db.prepare(`
        INSERT OR REPLACE INTO skill_clusters
        (cluster_id, cluster_name, skills, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(cluster.id, cluster.name, JSON.stringify(cluster.skills), now);
    }

    return clusters;
  } finally {
    db.close();
  }
}

/**
 * Record a successful skill usage pattern
 */
export async function recordSkillPattern(params: {
  dbPath: string;
  skills: string[];
  context?: string;
  success: boolean;
}): Promise<void> {
  const db = await initSkillEmbeddingsDb(params.dbPath);

  try {
    const sequence = params.skills.join(" -> ");
    const patternId = hashText(sequence);

    const existing = db
      .prepare("SELECT success_count, failure_count FROM skill_patterns WHERE pattern_id = ?")
      .get(patternId) as { success_count: number; failure_count: number } | undefined;

    if (existing) {
      const successCount = params.success ? existing.success_count + 1 : existing.success_count;
      const failureCount = params.success ? existing.failure_count : existing.failure_count + 1;

      db.prepare(`
        UPDATE skill_patterns
        SET success_count = ?, failure_count = ?, last_used = ?
        WHERE pattern_id = ?
      `).run(successCount, failureCount, Date.now(), patternId);
    } else {
      db.prepare(`
        INSERT INTO skill_patterns
        (pattern_id, skill_sequence, context, success_count, failure_count, created_at, last_used)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        patternId,
        sequence,
        params.context || "",
        params.success ? 1 : 0,
        params.success ? 0 : 1,
        Date.now(),
        Date.now(),
      );
    }
  } finally {
    db.close();
  }
}

/**
 * Get successful skill patterns for context
 */
export async function getRecommendedPatterns(params: {
  dbPath: string;
  limit?: number;
}): Promise<Array<{ sequence: string[]; successRate: number }>> {
  const db = await initSkillEmbeddingsDb(params.dbPath);
  const limit = params.limit ?? 5;

  try {
    const rows = db
      .prepare(`
      SELECT skill_sequence, success_count, failure_count
      FROM skill_patterns
      WHERE success_count > 0
      ORDER BY 
        CAST(success_count AS REAL) / (success_count + failure_count) DESC,
        success_count DESC
      LIMIT ?
    `)
      .all(limit) as Array<{
      skill_sequence: string;
      success_count: number;
      failure_count: number;
    }>;

    return rows.map((row) => ({
      sequence: row.skill_sequence.split(" -> "),
      successRate: row.success_count / (row.success_count + row.failure_count),
    }));
  } finally {
    db.close();
  }
}

// Helper functions

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function inferClusterName(skills: string[], seedDescription: string): string {
  // Simple heuristic: use common words from skill names
  const words = skills
    .flatMap((skill) => skill.toLowerCase().split(/[-_\s]+/))
    .filter((word) => word.length > 3);

  const wordCounts = new Map<string, number>();
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
  }

  // Find most common word
  let maxCount = 0;
  let commonWord = "skills";
  for (const [word, count] of wordCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      commonWord = word;
    }
  }

  return `${commonWord}-related`;
}
