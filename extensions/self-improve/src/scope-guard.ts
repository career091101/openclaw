/**
 * Scope guard: restricts which files the self-improve extension can modify.
 * Prevents accidental changes to critical infrastructure.
 */

const ALLOWED_PATHS = [
  "extensions/agent-autonomy/src/",
  "extensions/orchestrator/src/",
  "extensions/self-improve/src/",
  "src/agents/",
  "src/memory/",
  "src/plugins/",
];

const FORBIDDEN_PATHS = [
  "src/config/",
  "src/gateway/server",
  "src/cli/",
  "package.json",
  ".github/",
  "scripts/",
  "node_modules/",
  ".env",
];

const FORBIDDEN_COMMANDS = [
  "git push --force",
  "git push -f",
  "rm -rf",
  "npm publish",
  "pnpm publish",
  "git reset --hard",
];

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
  for (const forbidden of FORBIDDEN_COMMANDS) {
    if (normalized.includes(forbidden.toLowerCase())) {
      return false;
    }
  }
  return true;
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
