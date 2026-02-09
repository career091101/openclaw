# Agent Handoff Pattern

Swarm-style agent handoffs for OpenClaw, inspired by [OpenAI's Swarm framework](https://github.com/openai/swarm).

## Overview

The Agent Handoff Pattern enables explicit peer-to-peer agent delegation. Instead of hierarchical task delegation (supervisor → sub-agents), agents can directly hand off tasks to specialized peers with full context preservation.

## Key Concepts

### 1. Agent Registry

A registry of available specialist agents with their capabilities:

```typescript
{
  id: "code-specialist",
  name: "Code Specialist",
  description: "Expert in programming, debugging, code review",
  tags: ["code", "programming", "debug", "review"],
  toolGroups: ["filesystem", "exec", "git"],
  systemPrompt: "You are a code specialist..."
}
```

Default specialists:
- **code-specialist**: Programming, debugging, architecture
- **research-specialist**: Web research, information gathering
- **data-specialist**: Data analysis, statistics, visualization
- **writing-specialist**: Documentation, content creation
- **qa-specialist**: Testing, quality assurance, review

### 2. Handoff Context

Context that travels with handoffs:

```typescript
{
  handoffId: "abc123...",
  originSessionKey: "agent:main:session1",
  agentStack: ["agent:main:session1", "code-specialist"],
  sharedState: { fileName: "app.ts", error: "..." },
  reason: "Need code review expertise",
  timestamp: 1234567890
}
```

### 3. Handoff Strategies

- **wait-for-completion** (default): Wait for the target agent to finish and return the result
- **immediate**: Transfer control immediately without waiting
- **async**: Fire and forget (start the agent but don't wait)

## Usage

### Basic Handoff

```typescript
// Agent discovers it needs code review expertise
handoff_to_agent({
  targetAgentId: "code-specialist",
  task: "Review this TypeScript code for type safety issues: ...",
  reason: "I need expert code review",
  strategy: "wait-for-completion"
})
```

### Auto-Select Best Agent

```typescript
// Let the system pick the best specialist based on the task
handoff_to_agent({
  autoSelect: true,
  task: "Research the latest LLM architectures and summarize findings",
  reason: "Need research capabilities",
  strategy: "wait-for-completion"
})
```

### Shared State Across Handoffs

```typescript
// First handoff: research
handoff_to_agent({
  targetAgentId: "research-specialist",
  task: "Find the top 5 Node.js testing frameworks",
  reason: "Need research on testing options",
  sharedState: {
    project: "my-app",
    language: "TypeScript"
  },
  strategy: "wait-for-completion"
})

// Second handoff: code implementation (can access shared state)
handoff_to_agent({
  targetAgentId: "code-specialist",
  task: "Implement tests using the recommended framework from research",
  reason: "Need coding expertise",
  sharedState: {
    project: "my-app",
    language: "TypeScript",
    frameworks: ["vitest", "jest", "ava"]
  }
})
```

## Architecture

### vs. delegate_task (Orchestration)

| Feature | delegate_task | handoff_to_agent |
|---------|---------------|------------------|
| Structure | Hierarchical (supervisor → workers) | Peer-to-peer |
| Use case | Complex multi-step workflows | Single specialist consultation |
| Context | Task graph with dependencies | Flat handoff chain |
| Return | Task result via submit_result | Direct return value |
| State | Graph-level state | Shared context object |

**When to use delegate_task**: Multi-step workflows with dependencies (e.g., plan → execute → review)

**When to use handoff_to_agent**: Need specific expertise right now (e.g., "I need a code review", "I need research")

### Implementation

1. **Registry** (`registry.ts`): Manages available specialists
2. **Executor** (`executor.ts`): Handles handoff execution and context management
3. **Tool** (`tool.ts`): The `handoff_to_agent` tool agents can call
4. **Types** (`types.ts`): TypeScript definitions

### Flow

```
Agent A (working on task)
  ↓
  Realizes it needs specialist help
  ↓
  handoff_to_agent({ targetAgentId: "code-specialist", task: "...", reason: "..." })
  ↓
  Executor creates handoff context
  ↓
  Spawns specialist agent with specialized system prompt + context
  ↓
  Specialist completes task
  ↓
  Result returns to Agent A (if strategy = wait-for-completion)
```

## Extending

### Register Custom Specialists

```typescript
import { registerAgent } from "./registry.js";

registerAgent({
  id: "security-specialist",
  name: "Security Specialist",
  description: "Expert in security audits and vulnerability detection",
  tags: ["security", "audit", "vulnerability", "penetration"],
  toolGroups: ["filesystem", "exec"],
  systemPrompt: "You are a security specialist. Focus on identifying vulnerabilities..."
});
```

### Dynamic Availability

```typescript
import { setAgentAvailability } from "./registry.js";

// Disable an agent temporarily
setAgentAvailability("code-specialist", false);

// Re-enable
setAgentAvailability("code-specialist", true);
```

## Testing

Run tests:

```bash
npm test extensions/orchestrator/src/agent-handoff
```

Key test files:
- `registry.test.ts`: Agent registration and discovery
- `executor.test.ts`: Handoff context management

## Benefits

1. **Separation of Concerns**: Each agent focuses on its specialty
2. **Reusability**: Specialist agents can be used across different workflows
3. **Context Preservation**: Full handoff history and shared state
4. **Flexibility**: Peer-to-peer vs. hierarchical orchestration
5. **Transparency**: Clear handoff reasons and audit trail

## Future Enhancements

- [ ] Handoff chaining limits (prevent infinite loops)
- [ ] Handoff result caching (avoid duplicate specialist calls)
- [ ] Dynamic specialist spawning (create specialists on-demand)
- [ ] Handoff performance analytics
- [ ] Cross-orchestration handoffs (handoff between different orchestration graphs)
