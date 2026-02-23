#!/usr/bin/env python3
"""
JP225 (Nikkei 225) データ自動取得スクリプト
Elliott Wave Analysis スキル用

IG証券の日本225取引時間（月曜8:00 JST 〜 土曜7:00 JST）に
5分間隔で実行される想定。取引時間外は自動スキップ。

出力:
  data/latest.md       — 日足+月足（波動分析用、毎回更新）
  data/intraday.md     — 5分足直近データ（短期分析用、毎回更新）

使い方:
  python3 fetch_data.py           # 取引時間チェック有り（cron用）
  python3 fetch_data.py --force   # 取引時間無視で強制実行
"""

import sys
from datetime import datetime
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("ERROR: yfinance not installed. Run: pip3 install yfinance", file=sys.stderr)
    sys.exit(1)

# --- 設定 ---
SYMBOL_INDEX = "^N225"       # 現物指数（日足・月足）
SYMBOL_FUTURES = "NIY=F"     # CME円建て先物（5分足、IG証券に近い）
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
DAILY_FILE = OUTPUT_DIR / "latest.md"
INTRADAY_FILE = OUTPUT_DIR / "intraday.md"

# IG証券 日本225 取引時間 (JST)
# 月曜 08:00 〜 土曜 07:00（ほぼ24時間）
# weekday(): 0=Mon, 1=Tue, ..., 5=Sat, 6=Sun
IG_OPEN_WEEKDAY = 0   # Monday
IG_OPEN_HOUR = 8
IG_CLOSE_WEEKDAY = 5  # Saturday
IG_CLOSE_HOUR = 7


def is_ig_trading_hours(now: datetime) -> bool:
    """IG証券の日本225が取引中かどうか"""
    wd = now.weekday()
    h = now.hour

    # 日曜: 完全休場
    if wd == 6:
        return False
    # 土曜: 07:00まで
    if wd == 5:
        return h < IG_CLOSE_HOUR
    # 月曜: 08:00から
    if wd == 0:
        return h >= IG_OPEN_HOUR
    # 火〜金: 24時間
    return True


def flatten_columns(df):
    if hasattr(df.columns, "levels") and len(df.columns.levels) > 1:
        df.columns = df.columns.get_level_values(0)
    return df


def detect_pivots(df, lookback=5):
    """スイングハイ/ローの検出"""
    pivots = []
    for i in range(lookback, len(df) - lookback):
        h = df["High"].iloc[i]
        l = df["Low"].iloc[i]
        left_h = df["High"].iloc[i - lookback : i].max()
        right_h = df["High"].iloc[i + 1 : i + lookback + 1].max()
        left_l = df["Low"].iloc[i - lookback : i].min()
        right_l = df["Low"].iloc[i + 1 : i + lookback + 1].min()
        if h >= left_h and h >= right_h:
            pivots.append(("HIGH", df.index[i], h))
        if l <= left_l and l <= right_l:
            pivots.append(("LOW", df.index[i], l))
    filtered = []
    for p in sorted(pivots, key=lambda x: x[1]):
        if not filtered or (
            (p[1] - filtered[-1][1]).days >= 3 and abs(p[2] - filtered[-1][2]) > 300
        ):
            filtered.append(p)
    return filtered


def fetch_daily(now: datetime):
    """日足+月足データを取得して latest.md に保存"""
    print(f"Fetching {SYMBOL_INDEX} daily data...", file=sys.stderr)

    df6m = flatten_columns(
        yf.download(SYMBOL_INDEX, period="6mo", interval="1d", progress=False)
    )
    df2y = flatten_columns(
        yf.download(SYMBOL_INDEX, period="2y", interval="1d", progress=False)
    )

    if df6m.empty or df2y.empty:
        print("ERROR: No daily data returned", file=sys.stderr)
        return False

    latest = df6m.iloc[-1]
    pivots = detect_pivots(df6m)
    monthly = df2y.resample("ME").agg(
        {"Open": "first", "High": "max", "Low": "min", "Close": "last"}
    )

    lines = []
    lines.append(f"# JP225 市場データ ({now.strftime('%Y-%m-%d %H:%M')} 取得)")
    lines.append("")

    # 最新値
    lines.append("## 最新値")
    lines.append("")
    lines.append("| 項目 | 値 |")
    lines.append("|------|-----|")
    lines.append(f"| 日付 | {df6m.index[-1].strftime('%Y-%m-%d')} |")
    lines.append(f"| 終値 | {latest['Close']:.0f} |")
    lines.append(f"| 始値 | {latest['Open']:.0f} |")
    lines.append(f"| 高値 | {latest['High']:.0f} |")
    lines.append(f"| 安値 | {latest['Low']:.0f} |")
    lines.append("")

    # 統計
    lines.append("## 統計")
    lines.append("")
    lines.append("### 6ヶ月")
    lines.append(f"- 期間: {df6m.index[0].strftime('%Y-%m-%d')} 〜 {df6m.index[-1].strftime('%Y-%m-%d')}")
    lines.append(f"- 高値: {df6m['High'].max():.0f} ({df6m['High'].idxmax().strftime('%Y-%m-%d')})")
    lines.append(f"- 安値: {df6m['Low'].min():.0f} ({df6m['Low'].idxmin().strftime('%Y-%m-%d')})")
    lines.append("")
    lines.append("### 2年")
    lines.append(f"- 期間: {df2y.index[0].strftime('%Y-%m-%d')} 〜 {df2y.index[-1].strftime('%Y-%m-%d')}")
    lines.append(f"- 高値: {df2y['High'].max():.0f} ({df2y['High'].idxmax().strftime('%Y-%m-%d')})")
    lines.append(f"- 安値: {df2y['Low'].min():.0f} ({df2y['Low'].idxmin().strftime('%Y-%m-%d')})")
    lines.append("")

    # ピボット
    lines.append("## 主要転換ポイント (6ヶ月)")
    lines.append("")
    lines.append("| 日付 | 種別 | 価格 |")
    lines.append("|------|------|------|")
    for ptype, pdate, pprice in pivots:
        label = "高値" if ptype == "HIGH" else "安値"
        lines.append(f"| {pdate.strftime('%Y-%m-%d')} | {label} | {pprice:.0f} |")
    lines.append("")

    # 直近20日
    lines.append("## 直近20日 OHLC")
    lines.append("")
    lines.append("| 日付 | 始値 | 高値 | 安値 | 終値 | 出来高 |")
    lines.append("|------|------|------|------|------|--------|")
    for idx, row in df6m.tail(20).iterrows():
        lines.append(
            f"| {idx.strftime('%Y-%m-%d')} | {row['Open']:.0f} | {row['High']:.0f} "
            f"| {row['Low']:.0f} | {row['Close']:.0f} | {row['Volume']:.0f} |"
        )
    lines.append("")

    # 月足
    lines.append("## 月足サマリー (2年)")
    lines.append("")
    lines.append("| 月 | 始値 | 高値 | 安値 | 終値 |")
    lines.append("|----|------|------|------|------|")
    for idx, row in monthly.iterrows():
        lines.append(
            f"| {idx.strftime('%Y-%m')} | {row['Open']:.0f} | {row['High']:.0f} "
            f"| {row['Low']:.0f} | {row['Close']:.0f} |"
        )
    lines.append("")

    DAILY_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"OK: {DAILY_FILE} ({len(lines)} lines)", file=sys.stderr)
    return True


def fetch_intraday(now: datetime):
    """5分足データを取得して intraday.md に保存"""
    print(f"Fetching {SYMBOL_FUTURES} 5m intraday data...", file=sys.stderr)

    df5m = flatten_columns(
        yf.download(SYMBOL_FUTURES, period="5d", interval="5m", progress=False)
    )

    if df5m.empty:
        # 先物データがない場合は指数で代替
        print("Futures data empty, falling back to index...", file=sys.stderr)
        df5m = flatten_columns(
            yf.download(SYMBOL_INDEX, period="5d", interval="5m", progress=False)
        )

    if df5m.empty:
        print("WARNING: No intraday data available", file=sys.stderr)
        return False

    latest = df5m.iloc[-1]
    lines = []
    lines.append(f"# JP225 5分足データ ({now.strftime('%Y-%m-%d %H:%M')} 取得)")
    lines.append("")
    lines.append(f"- **ソース**: {SYMBOL_FUTURES}")
    lines.append(f"- **最新時刻**: {df5m.index[-1].strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"- **最新値**: {latest['Close']:.0f}")
    lines.append(f"- **5日間高値**: {df5m['High'].max():.0f}")
    lines.append(f"- **5日間安値**: {df5m['Low'].min():.0f}")
    lines.append(f"- **データ件数**: {len(df5m)} 本")
    lines.append("")

    # 直近60本（5時間分）
    lines.append("## 直近5時間 (60本)")
    lines.append("")
    lines.append("| 時刻 | 始値 | 高値 | 安値 | 終値 | 出来高 |")
    lines.append("|------|------|------|------|------|--------|")
    for idx, row in df5m.tail(60).iterrows():
        lines.append(
            f"| {idx.strftime('%m/%d %H:%M')} | {row['Open']:.0f} | {row['High']:.0f} "
            f"| {row['Low']:.0f} | {row['Close']:.0f} | {int(row['Volume'])} |"
        )
    lines.append("")

    # 1時間足に集約（波動分析用）
    df1h = df5m.resample("1h").agg(
        {"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}
    ).dropna()

    if not df1h.empty:
        lines.append("## 1時間足集約 (5日間)")
        lines.append("")
        lines.append("| 時刻 | 始値 | 高値 | 安値 | 終値 | 出来高 |")
        lines.append("|------|------|------|------|------|--------|")
        for idx, row in df1h.iterrows():
            lines.append(
                f"| {idx.strftime('%m/%d %H:%M')} | {row['Open']:.0f} | {row['High']:.0f} "
                f"| {row['Low']:.0f} | {row['Close']:.0f} | {int(row['Volume'])} |"
            )
        lines.append("")

    INTRADAY_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"OK: {INTRADAY_FILE} ({len(lines)} lines)", file=sys.stderr)
    return True


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now()
    force = "--force" in sys.argv

    # 取引時間チェック
    if not force and not is_ig_trading_hours(now):
        print(
            f"SKIP: Outside IG trading hours "
            f"({now.strftime('%A %H:%M')}). Use --force to override.",
            file=sys.stderr,
        )
        sys.exit(0)

    ok_daily = fetch_daily(now)
    ok_intra = fetch_intraday(now)

    if ok_daily:
        print(str(DAILY_FILE))
    if ok_intra:
        print(str(INTRADAY_FILE))

    if not ok_daily and not ok_intra:
        sys.exit(1)


if __name__ == "__main__":
    main()
