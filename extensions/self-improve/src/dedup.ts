/**
 * Duplicate tip detection: checks if a newly discovered tip
 * has already been recorded or is semantically similar to existing tips.
 */

import type { TipRecord } from "./types.js";

/** Normalize a string for comparison (lowercase, remove punctuation, collapse whitespace). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Calculate Jaccard similarity between two sets of words. */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalize(a).split(" "));
  const wordsB = new Set(normalize(b).split(" "));
  if (wordsA.size === 0 && wordsB.size === 0) {
    return 1;
  }
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

/** Check if a tip is a duplicate of any existing tip. */
export function isDuplicate(
  newTip: { title: string; summary: string; sourceUrl: string },
  existingTips: TipRecord[],
  threshold = 0.6,
): { duplicate: boolean; matchedTipId?: string; similarity?: number } {
  // Exact URL match
  for (const existing of existingTips) {
    if (existing.sourceUrl === newTip.sourceUrl) {
      return { duplicate: true, matchedTipId: existing.id, similarity: 1 };
    }
  }

  // Semantic similarity check on title + summary
  const newText = `${newTip.title} ${newTip.summary}`;
  for (const existing of existingTips) {
    const existingText = `${existing.title} ${existing.summary}`;
    const similarity = jaccardSimilarity(newText, existingText);
    if (similarity >= threshold) {
      return { duplicate: true, matchedTipId: existing.id, similarity };
    }
  }

  return { duplicate: false };
}

/** Filter out duplicate tips from a list of candidates. */
export function filterDuplicates(
  candidates: Array<{ title: string; summary: string; sourceUrl: string }>,
  existingTips: TipRecord[],
  threshold = 0.6,
): Array<{ title: string; summary: string; sourceUrl: string }> {
  const unique: Array<{ title: string; summary: string; sourceUrl: string }> = [];
  // Build up unique list, also checking against each other
  const allExisting = [...existingTips];

  for (const candidate of candidates) {
    const result = isDuplicate(candidate, allExisting, threshold);
    if (!result.duplicate) {
      unique.push(candidate);
      // Add to "existing" for subsequent dedup checks within the batch
      allExisting.push({
        id: "",
        title: candidate.title,
        summary: candidate.summary,
        sourceUrl: candidate.sourceUrl,
        discoveredAt: Date.now(),
        scores: { relevance: 0, feasibility: 0, impact: 0, total: 0 },
        status: "evaluated",
      } as TipRecord);
    }
  }

  return unique;
}
