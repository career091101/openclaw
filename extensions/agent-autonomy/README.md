# Agent Autonomy Extension

Provides self-correction, continuous execution loops, memory management, and context optimization for OpenClaw agents.

## Features

### 🔄 Continuous Autonomy Loop (NEW)

Inspired by the "Ralph Wiggum technique" from Vercel's ralph-loop-agent, this pattern enables agents to iteratively execute until a task is actually complete, rather than stopping after the first execution.

**Problem it solves:** Traditional agent loops execute once and stop, even if the task isn't complete. This leads to incomplete work and requires human intervention.

**Solution:** Wrap agent execution in an outer loop that:
1. Executes the agent/tool loop
2. Verifies if the task is actually complete
3. If not, provides feedback and runs another iteration
4. Stops when verification passes or limits are hit

#### Basic Usage

```typescript
import { continuousLoop, iterationCountIs } from "@openclaw/agent-autonomy";

const result = await continuousLoop(
  // Execute function - your agent/tool logic
  async ({ prompt, feedback, iteration }) => {
    const result = await runAgent(prompt, feedback);
    return result;
  },
  
  // Original prompt/task description
  "Refactor the authentication module to use JWT tokens",
  
  // Options
  {
    // Verify if task is complete
    verifyCompletion: async ({ result, iteration }) => {
      // Check if all requirements are met
      const hasJWT = result.includes("import jwt");
      const hasTests = result.includes("test");
      const passingTests = await runTests();
      
      if (hasJWT && hasTests && passingTests) {
        return { complete: true, reason: "All requirements met" };
      }
      
      return { 
        complete: false, 
        reason: "Tests failing - need to fix error handling" 
      };
    },
    
    // Stop after 10 iterations max
    stopWhen: iterationCountIs(10),
    
    // Optional: lifecycle hooks
    onIterationStart: ({ iteration }) => console.log(`Iteration ${iteration}`),
    onIterationEnd: ({ iteration, duration }) => 
      console.log(`Iteration ${iteration} took ${duration}ms`),
  }
);

console.log(`Completed in ${result.iterations} iterations`);
console.log(`Reason: ${result.completionReason}`);
```

#### Stop Conditions

Control when the loop terminates:

```typescript
import { 
  iterationCountIs, 
  tokenCountIs, 
  costIs 
} from "@openclaw/agent-autonomy";

// Stop after N iterations
stopWhen: iterationCountIs(20)

// Stop when token usage exceeds limit
stopWhen: tokenCountIs(100_000)

// Stop when cost exceeds budget (USD)
stopWhen: costIs(5.00)

// Combine multiple conditions (stops when ANY is met)
stopWhen: [
  iterationCountIs(50),
  tokenCountIs(100_000),
  costIs(5.00)
]
```

#### Simplified Retry Pattern

For simple retry-until-success scenarios:

```typescript
import { retryUntilSuccess } from "@openclaw/agent-autonomy";

const result = await retryUntilSuccess(
  async ({ prompt }) => {
    return await callAPI(prompt);
  },
  "Fetch user data",
  {
    maxIterations: 5,
    isSuccess: (result) => result.status === 200,
  }
);
```

#### Feedback Loop

Failed verifications automatically provide feedback to the next iteration:

```typescript
{
  verifyCompletion: async ({ result }) => {
    // Check result quality
    const hasError = result.errors?.length > 0;
    const missingFields = checkRequiredFields(result);
    
    if (hasError) {
      return {
        complete: false,
        reason: `Errors detected: ${result.errors.join(", ")}. Please fix these issues.`
      };
    }
    
    if (missingFields.length > 0) {
      return {
        complete: false,
        reason: `Missing required fields: ${missingFields.join(", ")}. Add these to complete the task.`
      };
    }
    
    return { complete: true, reason: "All validations passed" };
  }
}
```

The `reason` string is automatically injected as `[Verification feedback] ...` in the next iteration's prompt.

---

### 🔄 Self-Correction Loops

Automatic retry context injection based on tool failures. When tools fail, the retry wrapper classifies the error and suggests recovery strategies in the agent's next turn.

**Components:**
- `retry-wrapper.ts` - Records failures and injects retry context
- `error-classifier.ts` - Classifies errors (transient, resource, semantic, permanent)
- `tool-result-validator.ts` - Rule-based validation of tool results

---

### 🧠 Memory Management

#### JIT Context Injection
Intelligently injects relevant context from memory files before agent execution, using semantic search to find the most relevant snippets.

#### Structured Compaction
Organizes memory into structured sections (decisions, open questions, todos, context) during compaction cycles.

#### Memory Decay
Tracks access patterns and decay scores for memory entries to optimize what to keep/archive.

---

### ⚡ Task Reflection

Before submitting task results, agents perform self-review checks:
- Detects placeholder text (TODO, FIXME, etc.)
- Checks for error indicators in successful results
- Validates completeness against task requirements
- Suggests improvements

---

### 🛠 Tool Rehearsal

Practice mode for tool usage - agents can test tool calls before committing to them.

---

## Installation

This extension is included with OpenClaw. Enable it in your `~/.openclaw/plugins.json`:

```json
{
  "extensions": {
    "agent-autonomy": {
      "enabled": true
    }
  }
}
```

## Integration with OpenClaw Agent Lifecycle

The extension hooks into OpenClaw's agent lifecycle:

- `before_agent_start` - Injects retry context and JIT context
- `after_tool_call` - Validates tool results
- `before_compaction` / `after_compaction` - Structures memory

## References

- **Continuous Loop Pattern:** Inspired by [ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent) by Vercel Labs
- **Memory Patterns:** Influenced by LangGraph's state management and LangChain's memory abstractions
- **Self-Correction:** Based on error recovery patterns from production AI systems

## License

Apache-2.0 (same as OpenClaw)
