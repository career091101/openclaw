#!/bin/bash
set -euo pipefail

PLIST_NAME="com.openclaw.jp225-signals"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
STATE_DIR="$HOME/.openclaw/state/jp225-signals"
DIST_DIR="$STATE_DIR/dist"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Ensure directories exist
mkdir -p "$STATE_DIR" "$DIST_DIR"

# Unload if already loaded
if launchctl list | grep -q "$PLIST_NAME" 2>/dev/null; then
  echo "Unloading existing service..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# --- Build: compile TypeScript to JavaScript ---
echo "Building TypeScript..."

# Find tsc
TSC="$(which tsc 2>/dev/null || echo "")"
if [ -z "$TSC" ]; then
  for candidate in \
    "${SCRIPT_DIR}/../../node_modules/.bin/tsc" \
    "${SCRIPT_DIR}/node_modules/.bin/tsc"; do
    if [ -x "$candidate" ]; then
      TSC="$candidate"
      break
    fi
  done
fi
if [ -z "$TSC" ]; then
  echo "ERROR: tsc not found"
  exit 1
fi

# Compile to dist directory (inside ~/.openclaw, TCC-accessible)
cd "$SCRIPT_DIR"
"$TSC" --project "$SCRIPT_DIR/tsconfig.json" --outDir "$DIST_DIR"
# ESM requires package.json with type=module
echo '{"type":"module"}' > "$DIST_DIR/package.json"
echo "Built to: $DIST_DIR"

# Find node
NODE_PATH_BIN="$(which node 2>/dev/null || echo "/opt/homebrew/bin/node")"
echo "Using node: $NODE_PATH_BIN"

# Create plist (runs compiled JS with plain node, no tsx needed)
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH_BIN}</string>
    <string>${DIST_DIR}/main.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${STATE_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${STATE_DIR}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${STATE_DIR}/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>JP225_STATE_DIR</key>
    <string>${STATE_DIR}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
EOF

echo "Plist created: $PLIST_PATH"

# Optionally set Slack env vars
if [ -n "${SLACK_BOT_TOKEN:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:SLACK_BOT_TOKEN string $SLACK_BOT_TOKEN" "$PLIST_PATH" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:SLACK_BOT_TOKEN $SLACK_BOT_TOKEN" "$PLIST_PATH"
fi

if [ -n "${SLACK_CHANNEL:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:SLACK_CHANNEL string $SLACK_CHANNEL" "$PLIST_PATH" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:SLACK_CHANNEL $SLACK_CHANNEL" "$PLIST_PATH"
fi

# Load the service
launchctl load "$PLIST_PATH"
echo ""
echo "Service loaded: $PLIST_NAME"
echo "Check status:  launchctl list | grep jp225"
echo "View logs:     tail -f $STATE_DIR/stdout.log"
echo "Uninstall:     bash $SCRIPT_DIR/scripts/uninstall.sh"
