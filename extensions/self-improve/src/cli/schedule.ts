/**
 * CLI handler types for `openclaw improve schedule`.
 * The actual CLI registration is in index.ts via api.registerCli().
 * This module is retained for backward compatibility and type exports.
 */

export type ImproveScheduleOptions = {
  set?: string;
  enable?: boolean;
  disable?: boolean;
  remove?: boolean;
};

/** Default cron expression: every Sunday at 3:00 UTC */
export const DEFAULT_CRON = "0 3 * * 0";
