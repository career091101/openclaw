/**
 * Tests for agent handoff registry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerAgent,
  unregisterAgent,
  getAgent,
  listAgents,
  findAgent,
  setAgentAvailability,
  clearRegistry,
} from "./registry.js";

describe("Agent Handoff Registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("should register an agent", () => {
    registerAgent({
      id: "test-agent",
      name: "Test Agent",
      description: "A test agent",
      tags: ["test"],
    });

    const agent = getAgent("test-agent");
    expect(agent).toBeDefined();
    expect(agent?.name).toBe("Test Agent");
    expect(agent?.available).toBe(true);
  });

  it("should unregister an agent", () => {
    registerAgent({
      id: "test-agent",
      name: "Test Agent",
      description: "A test agent",
      tags: ["test"],
    });

    expect(unregisterAgent("test-agent")).toBe(true);
    expect(getAgent("test-agent")).toBeUndefined();
  });

  it("should list all agents", () => {
    registerAgent({
      id: "agent-1",
      name: "Agent 1",
      description: "First agent",
      tags: ["tag1"],
    });

    registerAgent({
      id: "agent-2",
      name: "Agent 2",
      description: "Second agent",
      tags: ["tag2"],
    });

    const agents = listAgents();
    expect(agents).toHaveLength(2);
  });

  it("should filter agents by tags", () => {
    registerAgent({
      id: "agent-1",
      name: "Agent 1",
      description: "First agent",
      tags: ["coding", "review"],
    });

    registerAgent({
      id: "agent-2",
      name: "Agent 2",
      description: "Second agent",
      tags: ["research", "analysis"],
    });

    const codingAgents = listAgents({ tags: ["coding"] });
    expect(codingAgents).toHaveLength(1);
    expect(codingAgents[0].id).toBe("agent-1");
  });

  it("should filter agents by availability", () => {
    registerAgent({
      id: "agent-1",
      name: "Agent 1",
      description: "First agent",
      tags: ["tag1"],
    });

    registerAgent({
      id: "agent-2",
      name: "Agent 2",
      description: "Second agent",
      tags: ["tag2"],
    });

    setAgentAvailability("agent-1", false);

    const available = listAgents({ available: true });
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe("agent-2");
  });

  it("should find agent by task description", () => {
    registerAgent({
      id: "code-agent",
      name: "Code Specialist",
      description: "Expert in programming and debugging",
      tags: ["code", "programming", "debug"],
    });

    registerAgent({
      id: "research-agent",
      name: "Research Specialist",
      description: "Expert in web research",
      tags: ["research", "web", "search"],
    });

    const result = findAgent("I need help debugging a JavaScript function");
    expect(result).toBeDefined();
    expect(result?.id).toBe("code-agent");
  });

  it("should return undefined when no agent matches", () => {
    registerAgent({
      id: "code-agent",
      name: "Code Specialist",
      description: "Expert in programming",
      tags: ["code", "programming"],
    });

    const result = findAgent("I need help with quantum physics");
    expect(result).toBeUndefined();
  });

  it("should update agent availability", () => {
    registerAgent({
      id: "test-agent",
      name: "Test Agent",
      description: "A test agent",
      tags: ["test"],
    });

    expect(setAgentAvailability("test-agent", false)).toBe(true);
    const agent = getAgent("test-agent");
    expect(agent?.available).toBe(false);
  });

  it("should return false when setting availability of non-existent agent", () => {
    expect(setAgentAvailability("nonexistent", false)).toBe(false);
  });
});
