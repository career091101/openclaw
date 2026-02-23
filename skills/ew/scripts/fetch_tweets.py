#!/usr/bin/env python3
"""Fetch @jewri225 tweets with local caching to minimize X API costs.

Usage:
    python3 fetch_tweets.py          # fetch new tweets since last cache
    python3 fetch_tweets.py --force  # re-fetch all (ignore cache)
    python3 fetch_tweets.py --stats  # show cache stats

Cost optimization:
    - Hardcoded user ID (saves 1 API call per run)
    - since_id caching (0 calls if no new tweets)
    - exclude=retweets (fewer tweets to read)
    - Local image cache (no re-download)
    Result: ~80% reduction vs naive approach
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DATA_DIR = SKILL_DIR / "data"
IMAGES_DIR = DATA_DIR / "tweet_images"
CACHE_FILE = DATA_DIR / "tweets_cache.json"
OUTPUT_FILE = DATA_DIR / "tweets.md"
ENV_FILE = SKILL_DIR / ".env"

USER_ID = "410257269"  # @jewri225 — hardcoded to skip /users/by/username call
MAX_RESULTS = 30

MARKET_KEYWORDS = [
    "波", "カウント", "ダイアゴナル", "トライアングル", "インパルス",
    "フラット", "ジグザグ", "フィボ", "225", "TOPIX", "ドル円",
    "原油", "ビットコイン", "レポート", "vol.", "無効化", "リーディング",
    "修正", "推進", "ダブル", "トリプル", "シナリオ", "サポート",
    "レジスタンス", "RSI", "REIT", "ネックライン", "5波", "3波",
    "想定", "確度", "目標", "note", "パターン", "チャネル",
    "ブレイク", "セミナー", "エリオット", "ディグリー", "概観",
]


def load_env():
    token = os.environ.get("X_BEARER_TOKEN")
    if token:
        return token
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or not line:
                continue
            if line.startswith("X_BEARER_TOKEN="):
                val = line.split("=", 1)[1].strip()
                return val.strip('"').strip("'")
    return None


def load_cache():
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"since_id": None, "tweets": [], "media": {}, "updated_at": None}


def save_cache(cache):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2))


def api_get(url, token):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "OpenClaw-EW-Skill/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"API Error {e.code}: {body}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return None


def fetch_tweets(token, since_id=None):
    url = (
        f"https://api.x.com/2/users/{USER_ID}/tweets"
        f"?max_results={MAX_RESULTS}"
        f"&exclude=retweets"
        f"&tweet.fields=created_at,text,attachments"
        f"&media.fields=url,preview_image_url"
        f"&expansions=attachments.media_keys"
    )
    if since_id:
        url += f"&since_id={since_id}"
    return api_get(url, token)


def download_image(url, dest):
    if dest.exists():
        return False
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(url, str(dest))
        return True
    except Exception as e:
        print(f"Image download failed ({dest.name}): {e}", file=sys.stderr)
        return False


def is_market_relevant(text):
    return any(kw in text for kw in MARKET_KEYWORDS)


def format_time_jst(iso_str):
    """Convert ISO timestamp to JST display (UTC+9)."""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        from datetime import timezone, timedelta
        jst = timezone(timedelta(hours=9))
        dt_jst = dt.astimezone(jst)
        return dt_jst.strftime("%m/%d %H:%M")
    except Exception:
        return iso_str[:16].replace("T", " ")


def generate_markdown(cache):
    lines = [
        "# @jewri225 ツイート分析データ",
        "",
        f"**最終更新**: {cache.get('updated_at', 'N/A')}",
        f"**キャッシュ総数**: {len(cache['tweets'])}件（RT除外済み）",
        "",
        "---",
        "",
        "## 波動分析・市場関連ツイート",
        "",
    ]

    analysis = []
    other = []

    for t in cache["tweets"]:
        text = t.get("text", "").replace("\n", " ")
        ts = format_time_jst(t.get("created_at", ""))
        has_img = bool(t.get("attachments", {}).get("media_keys"))
        img_tag = " **[チャート]**" if has_img else ""

        # Build image paths for reference
        img_paths = ""
        if has_img:
            keys = t.get("attachments", {}).get("media_keys", [])
            for k in keys:
                m = cache.get("media", {}).get(k, {})
                if m.get("type") == "photo":
                    ext = m.get("url", "").rsplit(".", 1)[-1].split("?")[0]
                    img_paths += f" `tweet_images/{k}.{ext}`"

        entry = f"- **[{ts}]** {text}{img_tag}{img_paths}"

        if is_market_relevant(t.get("text", "")):
            analysis.append(entry)
        else:
            other.append(entry)

    lines.extend(analysis if analysis else ["（新規ツイートなし）"])
    lines.append("")

    if other:
        lines.append("## その他")
        lines.append("")
        lines.extend(other[:5])
        if len(other) > 5:
            lines.append(f"（他 {len(other) - 5}件省略）")
        lines.append("")

    OUTPUT_FILE.write_text("\n".join(lines), encoding="utf-8")
    return len(analysis), len(other)


def main():
    force = "--force" in sys.argv
    stats = "--stats" in sys.argv

    cache = load_cache()

    if stats:
        print(f"Cache: {len(cache['tweets'])} tweets")
        print(f"Updated: {cache.get('updated_at', 'N/A')}")
        print(f"Since ID: {cache.get('since_id', 'N/A')}")
        mkt = sum(1 for t in cache["tweets"] if is_market_relevant(t.get("text", "")))
        print(f"Market-relevant: {mkt}")
        return

    token = load_env()
    if not token:
        print(f"ERROR: X_BEARER_TOKEN not found.", file=sys.stderr)
        print(f"Set in {ENV_FILE} or as environment variable.", file=sys.stderr)
        sys.exit(1)

    since_id = None if force else cache.get("since_id")
    resp = fetch_tweets(token, since_id)

    if not resp:
        # API failed — still generate markdown from cache if available
        if cache["tweets"]:
            print("API call failed. Using cached data.", file=sys.stderr)
            generate_markdown(cache)
            print(str(OUTPUT_FILE))
        sys.exit(1)

    count = resp.get("meta", {}).get("result_count", 0)
    print(f"API: 1 call, {count} new tweets fetched")

    if count == 0:
        if cache["tweets"]:
            print(f"Cache up to date ({len(cache['tweets'])} tweets)")
            if not OUTPUT_FILE.exists():
                generate_markdown(cache)
            print(str(OUTPUT_FILE))
            return
        else:
            print("No tweets found and no cache.", file=sys.stderr)
            return

    # Process new tweets
    new_tweets = resp.get("data", [])
    media_map = cache.get("media", {})
    for m in resp.get("includes", {}).get("media", []):
        media_map[m["media_key"]] = m

    # Download images
    img_count = 0
    for m_key, m_info in media_map.items():
        if m_info.get("type") == "photo" and m_info.get("url"):
            ext = m_info["url"].rsplit(".", 1)[-1].split("?")[0]
            dest = IMAGES_DIR / f"{m_key}.{ext}"
            if download_image(m_info["url"], dest):
                img_count += 1

    # Merge with cache
    existing_ids = {t["id"] for t in cache["tweets"]}
    added = 0
    for t in new_tweets:
        if t["id"] not in existing_ids:
            cache["tweets"].append(t)
            added += 1

    # Sort newest first
    cache["tweets"].sort(key=lambda t: t.get("created_at", ""), reverse=True)

    # Update metadata
    newest = resp.get("meta", {}).get("newest_id")
    if newest:
        cache["since_id"] = newest
    cache["media"] = media_map
    cache["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    save_cache(cache)

    # Generate markdown
    n_analysis, n_other = generate_markdown(cache)
    total = len(cache["tweets"])
    print(f"OK: {OUTPUT_FILE}")
    print(f"  Total: {total} tweets ({added} new, {img_count} new images)")
    print(f"  Market-relevant: {n_analysis}, Other: {n_other}")
    print(str(OUTPUT_FILE))


if __name__ == "__main__":
    main()
