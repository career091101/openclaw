/**
 * Agent Handoff Pattern for OpenClaw.
 * Inspired by OpenAI's Swarm framework for explicit agent delegation.
 *
 * This module enables Swarm-style agent handoffs where agents can explicitly
 * transfer control to specialized peer agents with context preservation.
 */

export * from "./types.js";
export * from "./registry.js";
export * from "./executor.js";
export * from "./tool.js";

// Initialize default agents on module load
import { initializeDefaultAgents } from "./registry.js";
initializeDefaultAgents();
