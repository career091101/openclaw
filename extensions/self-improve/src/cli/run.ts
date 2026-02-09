/**
 * CLI handler types for `openclaw improve run`.
 * The actual CLI registration is in index.ts via api.registerCli().
 * This module is retained for backward compatibility and type exports.
 */

export type ImproveRunOptions = {
  dryRun?: boolean;
  tipId?: string;
  maxTips?: number;
};
