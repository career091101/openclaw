#!/bin/bash
#
# Elliott Wave 自動分析ランナー
# 1. データ取得 → 2. OpenClaw で分析 → 3. レポート保存
#
# 使い方:
#   手動実行: bash skills/ew/scripts/run_analysis.sh
#   launchd:  自動で毎日実行（下記plist参照）
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_FILE="$SKILL_DIR/data/latest.md"
REPORT_DIR="$HOME/.openclaw/workspace/elliott-wave-analysis/documents/4_executing/strategies"
TIMESTAMP=$(date +%Y-%m-%d)
REPORT_FILE="$REPORT_DIR/EW_Auto_${TIMESTAMP}.md"
LOG_FILE="/tmp/ew-analysis.log"

echo "[$(date)] Starting EW analysis..." | tee -a "$LOG_FILE"

# Step 1: データ取得
echo "[$(date)] Fetching market data..." | tee -a "$LOG_FILE"
python3 "$SKILL_DIR/scripts/fetch_data.py" 2>&1 | tee -a "$LOG_FILE"

if [ ! -f "$DATA_FILE" ]; then
    echo "[$(date)] ERROR: Data file not created" | tee -a "$LOG_FILE"
    exit 1
fi

# Step 2: OpenClaw で分析実行
echo "[$(date)] Running EW analysis via OpenClaw..." | tee -a "$LOG_FILE"

# OpenClaw CLI がインストールされているか確認
if command -v openclaw &>/dev/null; then
    CLAW_CMD="openclaw"
elif [ -x "/opt/homebrew/bin/openclaw" ]; then
    CLAW_CMD="/opt/homebrew/bin/openclaw"
elif [ -x "$HOME/.local/bin/openclaw" ]; then
    CLAW_CMD="$HOME/.local/bin/openclaw"
else
    echo "[$(date)] WARNING: openclaw CLI not found. Data fetched but analysis skipped." | tee -a "$LOG_FILE"
    echo "[$(date)] Run '/ew' manually in OpenClaw to analyze the data." | tee -a "$LOG_FILE"
    exit 0
fi

mkdir -p "$REPORT_DIR"

# OpenClaw に分析を依頼（非対話モード）
$CLAW_CMD --print -p "$(cat <<PROMPT
/ew を実行してください。
市場データは $DATA_FILE に保存済みです。このファイルを読み込んで分析してください。
分析結果を以下のファイルに保存してください: $REPORT_FILE
PROMPT
)" 2>&1 | tee -a "$LOG_FILE"

if [ -f "$REPORT_FILE" ]; then
    echo "[$(date)] SUCCESS: Report saved to $REPORT_FILE" | tee -a "$LOG_FILE"
else
    echo "[$(date)] WARNING: Report file not created. Check log for details." | tee -a "$LOG_FILE"
fi

echo "[$(date)] Done." | tee -a "$LOG_FILE"
