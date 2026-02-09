/**
 * Registry for agent capabilities and handoff patterns.
 * Allows agents to discover and hand off to specialized peers.
 */

import type { AgentCapability, AgentRegistration } from "./types.js";

/** In-memory registry of available agents */
const agentRegistry = new Map<string, AgentRegistration>();

/**
 * Register an agent capability.
 */
export function registerAgent(capability: AgentCapability): void {
  const registration: AgentRegistration = {
    ...capability,
    registeredAt: Date.now(),
    available: true,
  };
  agentRegistry.set(capability.id, registration);
}

/**
 * Unregister an agent capability.
 */
export function unregisterAgent(id: string): boolean {
  return agentRegistry.delete(id);
}

/**
 * Get an agent by ID.
 */
export function getAgent(id: string): AgentRegistration | undefined {
  return agentRegistry.get(id);
}

/**
 * List all registered agents.
 */
export function listAgents(filter?: { tags?: string[]; available?: boolean }): AgentRegistration[] {
  const agents = Array.from(agentRegistry.values());

  if (!filter) {
    return agents;
  }

  return agents.filter((agent) => {
    if (filter.available !== undefined && agent.available !== filter.available) {
      return false;
    }
    if (filter.tags && !filter.tags.some((tag) => agent.tags.includes(tag))) {
      return false;
    }
    return true;
  });
}

/**
 * Find the best agent for a given task description.
 * Uses simple keyword matching against tags and description.
 */
export function findAgent(taskDescription: string): AgentRegistration | undefined {
  const lowercaseTask = taskDescription.toLowerCase();
  const agents = listAgents({ available: true });

  // Score each agent based on keyword matches
  const scored = agents.map((agent) => {
    let score = 0;

    // Check tags
    for (const tag of agent.tags) {
      if (lowercaseTask.includes(tag.toLowerCase())) {
        score += 2;
      }
    }

    // Check name and description
    if (lowercaseTask.includes(agent.name.toLowerCase())) {
      score += 3;
    }
    if (agent.description.toLowerCase().includes(lowercaseTask)) {
      score += 1;
    }

    return { agent, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return the top agent if it has a positive score
  return scored[0]?.score > 0 ? scored[0].agent : undefined;
}

/**
 * Mark an agent as available or unavailable.
 */
export function setAgentAvailability(id: string, available: boolean): boolean {
  const agent = agentRegistry.get(id);
  if (!agent) {
    return false;
  }
  agent.available = available;
  return true;
}

/**
 * Clear all registered agents (for testing).
 */
export function clearRegistry(): void {
  agentRegistry.clear();
}

/** Initialize with default specialist agents */
export function initializeDefaultAgents(): void {
  registerAgent({
    id: "code-specialist",
    name: "Code Specialist",
    description: "Expert in programming, debugging, code review, and software architecture",
    tags: ["code", "programming", "debug", "review", "architecture", "refactor"],
    toolGroups: ["filesystem", "exec", "git"],
    systemPrompt:
      "You are a code specialist. Focus on writing clean, maintainable, well-tested code. " +
      "Always consider edge cases and error handling.",
  });

  registerAgent({
    id: "research-specialist",
    name: "Research Specialist",
    description: "Expert in web research, information gathering, and analysis",
    tags: ["research", "search", "analyze", "investigate", "web", "information"],
    toolGroups: ["web"],
    systemPrompt:
      "You are a research specialist. Gather comprehensive information from reliable sources. " +
      "Synthesize findings into clear, actionable insights.",
  });

  registerAgent({
    id: "data-specialist",
    name: "Data Specialist",
    description: "Expert in data analysis, statistics, and visualization",
    tags: ["data", "analysis", "statistics", "visualization", "charts", "csv", "json"],
    toolGroups: ["filesystem", "exec"],
    systemPrompt:
      "You are a data specialist. Focus on accurate analysis and clear visualization of data. " +
      "Always verify data integrity before drawing conclusions.",
  });

  registerAgent({
    id: "writing-specialist",
    name: "Writing Specialist",
    description: "Expert in technical writing, documentation, and content creation",
    tags: ["writing", "documentation", "content", "technical", "markdown", "docs"],
    toolGroups: ["filesystem"],
    systemPrompt:
      "You are a writing specialist. Create clear, well-structured documentation. " +
      "Use appropriate tone and style for the audience.",
  });

  registerAgent({
    id: "qa-specialist",
    name: "QA Specialist",
    description: "Expert in testing, quality assurance, and code review",
    tags: ["qa", "testing", "review", "quality", "validation", "verification"],
    toolGroups: ["filesystem", "exec"],
    systemPrompt:
      "You are a QA specialist. Thoroughly review outputs for correctness, completeness, and quality. " +
      "Provide actionable feedback for improvements.",
  });
}
