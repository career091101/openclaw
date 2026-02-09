/**
 * Context bridge: builds structured messages for the cron isolated agent session.
 * Provides the agent with existing state and configuration for the self-improve loop.
 */

import { SELF_IMPROVE_PROMPT } from "./prompts.js";

export function buildAgentMessage(opts: {
  dryRun?: boolean;
  tipId?: string;
  maxTips?: number;
  existingTipTitles: string[];
  lastRunSummary?: string;
}): string {
  const sections: string[] = [];

  // System prompt reference
  sections.push(SELF_IMPROVE_PROMPT);
  sections.push("\n---\n");

  // Configuration
  sections.push("## Run Configuration");
  if (opts.dryRun) {
    sections.push(
      "- **Mode**: DRY RUN — research and evaluate only, do NOT implement or create PRs",
    );
  } else {
    sections.push("- **Mode**: FULL — research, implement, and create PR");
  }
  if (opts.tipId) {
    sections.push(`- **Target Tip**: ${opts.tipId} (skip research, implement this tip directly)`);
  }
  sections.push(`- **Max Tips to Research**: ${opts.maxTips ?? 10}`);

  // Existing tips
  if (opts.existingTipTitles.length > 0) {
    sections.push("\n## Already Discovered Tips (avoid duplicates)");
    for (const title of opts.existingTipTitles) {
      sections.push(`- ${title}`);
    }
  } else {
    sections.push("\n## Already Discovered Tips\nNone — this is the first run.");
  }

  // Last run summary
  if (opts.lastRunSummary) {
    sections.push(`\n## Last Run Summary\n${opts.lastRunSummary}`);
  }

  sections.push(
    "\n---\nBegin the self-improvement workflow now. Start by calling check_improve_status.",
  );
  return sections.join("\n");
}
