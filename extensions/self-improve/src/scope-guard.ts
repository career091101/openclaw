/**
 * Scope guard: restricts which files the self-improve extension can modify.
 * Prevents accidental changes to critical infrastructure.
 */

const ALLOWED_PATHS = [
  "extensions/agent-autonomy/src/",
  "extensions/orchestrator/src/",
  "extensions/self-improve/src/",
  "src/agents/",
  "src/cli/",
  "src/config/",
  "src/memory/",
  "src/plugins/",
  "scripts/",
];

const FORBIDDEN_PATHS = ["src/gateway/server", "package.json", ".github/", "node_modules/", ".env"];

const COMMAND_SEPARATORS = /(?:&&|\|\||;|\n)/;
const ENV_ASSIGNMENT = /^[a-z_][a-z0-9_]*=.*/;

/** Check if a file path is allowed for modification. */
export function isAllowedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  // Check forbidden first
  for (const forbidden of FORBIDDEN_PATHS) {
    if (normalized.includes(forbidden)) {
      return false;
    }
  }
  // Allow any test file
  if (normalized.endsWith(".test.ts")) {
    return true;
  }
  // Check allowed
  for (const allowed of ALLOWED_PATHS) {
    if (normalized.includes(allowed)) {
      return true;
    }
  }
  return false;
}

/** Check if a command is allowed for execution. */
export function isAllowedCommand(command: string): boolean {
  const normalized = command.toLowerCase().trim();
  if (!normalized) {
    return true;
  }

  const segments = normalized.split(COMMAND_SEPARATORS);
  for (const segment of segments) {
    const tokens = tokenizeCommandSegment(segment);
    const commandTokens = stripLeadingEnvAssignments(tokens);
    if (commandTokens.length === 0) {
      continue;
    }

    if (isPublishCommand(commandTokens)) {
      return false;
    }
    if (isGitResetHardCommand(commandTokens)) {
      return false;
    }
    if (isDangerousRmCommand(commandTokens)) {
      return false;
    }
  }
  return true;
}

function tokenizeCommandSegment(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean);
}

function stripLeadingEnvAssignments(tokens: string[]): string[] {
  let start = 0;
  while (start < tokens.length && ENV_ASSIGNMENT.test(tokens[start])) {
    start += 1;
  }
  return tokens.slice(start);
}

function isPublishCommand(tokens: string[]): boolean {
  const exec = tokens[0];
  if (exec !== "npm" && exec !== "pnpm") {
    return false;
  }

  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] !== "publish") {
      continue;
    }
    const prev = tokens[i - 1] ?? "";
    if (prev === "run" || prev === "exec") {
      continue;
    }
    return true;
  }
  return false;
}

function isGitResetHardCommand(tokens: string[]): boolean {
  if (tokens[0] !== "git") {
    return false;
  }

  const resetIdx = tokens.indexOf("reset");
  if (resetIdx === -1) {
    return false;
  }

  if (tokens[resetIdx - 1] === "help") {
    return false;
  }

  const hardIdx = tokens.indexOf("--hard");
  return hardIdx > resetIdx;
}

function isDangerousRmCommand(tokens: string[]): boolean {
  if (tokens[0] !== "rm") {
    return false;
  }

  let recursive = false;
  let force = false;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--") {
      break;
    }

    if (token === "--recursive") {
      recursive = true;
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }

    if (token.startsWith("--")) {
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      for (const flag of token.slice(1)) {
        if (flag === "r") {
          recursive = true;
        } else if (flag === "f") {
          force = true;
        }
      }
    }
  }

  return recursive && force;
}

/** Get human-readable reason why a path is forbidden. */
export function getPathBlockReason(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  for (const forbidden of FORBIDDEN_PATHS) {
    if (normalized.includes(forbidden)) {
      return `path contains forbidden segment: ${forbidden}`;
    }
  }
  return `path not in allowed list: ${ALLOWED_PATHS.join(", ")}`;
}
