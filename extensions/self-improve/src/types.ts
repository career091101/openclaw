/**
 * Type definitions for the self-improve extension.
 */

export type TipStatus =
  | "evaluated"
  | "planned"
  | "implementing"
  | "implemented"
  | "rejected"
  | "failed";

export type TipScores = {
  relevance: number;
  feasibility: number;
  impact: number;
  total: number;
};

export type TipRecord = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  discoveredAt: number;
  scores: TipScores;
  status: TipStatus;
  rejectionReason?: string;
  implementationPr?: string;
  orchestrationId?: string;
  branchName?: string;
  implementedAt?: number;
};

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export type RunRecord = {
  id: string;
  startedAt: number;
  completedAt?: number;
  trigger: "cron" | "manual";
  status: RunStatus;
  tipsResearched: number;
  tipsImplemented: number;
  prsCreated: string[];
  totalTokens: number;
  totalCostUsd: number;
  error?: string;
};
