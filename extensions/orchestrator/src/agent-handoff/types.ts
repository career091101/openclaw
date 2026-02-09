/**
 * Type definitions for Swarm-style agent handoffs.
 * Inspired by OpenAI's Swarm framework for explicit agent delegation.
 */

/**
 * Agent capability descriptor
 */
export type AgentCapability = {
  /** Unique identifier for this agent capability */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this agent specializes in */
  description: string;
  /** Keywords/tags for matching */
  tags: string[];
  /** Tool groups this agent has access to */
  toolGroups?: string[];
  /** System prompt additions for this specialist */
  systemPrompt?: string;
};

/**
 * Context that travels with a handoff
 */
export type HandoffContext = {
  /** Unique ID for this handoff chain */
  handoffId: string;
  /** Session key of the originating agent */
  originSessionKey: string;
  /** Stack of agent IDs that have handled this request */
  agentStack: string[];
  /** Shared state that persists across handoffs */
  sharedState: Record<string, unknown>;
  /** Reason for the handoff */
  reason: string;
  /** Timestamp of handoff */
  timestamp: number;
};

/**
 * Result of a handoff operation
 */
export type HandoffResult = {
  /** Whether the handoff was successful */
  success: boolean;
  /** Session key of the new agent (if successful) */
  targetSessionKey?: string;
  /** Context for the handoff */
  context?: HandoffContext;
  /** Error message (if failed) */
  error?: string;
  /** Output from the target agent (if completed) */
  output?: string;
};

/**
 * Handoff strategy
 */
export type HandoffStrategy =
  | "immediate" // Transfer control immediately
  | "wait-for-completion" // Wait for target to complete before returning
  | "async"; // Fire and forget

/**
 * Registration record for an agent capability
 */
export type AgentRegistration = AgentCapability & {
  /** When this agent was registered */
  registeredAt: number;
  /** Session key pattern (if specific to a session) */
  sessionPattern?: string;
  /** Whether this agent is currently available */
  available: boolean;
};
