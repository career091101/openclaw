#!/bin/bash
set -euo pipefail

PLIST_NAME="com.openclaw.jp225-signals"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

if [ -f "$PLIST_PATH" ]; then
  echo "Unloading service..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "Service uninstalled: $PLIST_NAME"
else
  echo "Service not installed: $PLIST_PATH not found"
fi

echo ""
echo "Note: State data preserved at ~/.openclaw/state/jp225-signals/"
echo "To remove state: rm -rf ~/.openclaw/state/jp225-signals/"
