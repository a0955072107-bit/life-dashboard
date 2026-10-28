"""抓取國際新聞 RSS → data/news.json；有 ANTHROPIC_API_KEY 時另外產生繁中重點摘要"""
import calendar
import sys
from datetime import datetime, timedelta, timezone

import feedparser
import requests

from common import CONFIG, UA, claude_client, claude_json, now_iso, write_json


def published(entry) -> str | None:
    t = entry.get("published_parsed") or entry.get("updated_parsed")
    return datetime.fromtimestamp(calendar.timegm(t), timezone.utc).isoformat() if t else None


def main() -> int:
    items, cutoff = [], datetime.now(timezone.utc) - timedelta(hours=36)
    for feed in CONFIG["newsFeeds"]:
        try:
            r = requests.get(feed["url"], headers={"User-Agent": UA}, timeout=20)
            r.raise_for_status()
            parsed = feedparser.parse(r.content)
        except Exception as e:  # noqa: BLE001
            print("WARN", feed["name"], e, file=sys.stderr)
            continue
        for e in parsed.entries[:25]:
            pub = published(e)
            if pub and datetime.fromisoformat(pub) < cutoff:
                continue
            items.append({
                "title": e.get("title", "").strip(),
                "link": e.get("link"),
                "source": feed["name"],
                "lang": feed["lang"],
                "published": pub,
                "summary": (e.get("summary") or "")[:300],
            })
    if not items:
        print("no news fetched", file=sys.stderr)
        return 1
    items.sort(key=lambda i: i["published"] or "", reverse=True)

    brief = []
    client = claude_client()
    if client:
        headlines = "\n".join(f"- [{i['source']}] {i['title']}" for i in items[:80])
        try:
            brief = claude_json(
                client,
                "以下是過去一天的國際新聞標題。請挑出最重要的 6 則國際大事，"
                "各用一句繁體中文（台灣用語，40 字內）說明發生什麼事與為何重要；"
                "重複報導合併，不要逐條翻譯標題。\n\n" + headlines,
                {
                    "type": "object",
                    "properties": {"brief": {"type": "array", "items": {"type": "string"}}},
                    "required": ["brief"],
                    "additionalProperties": False,
                },
            )["brief"]
        except Exception as e:  # noqa: BLE001 - summary is optional
            print("WARN brief:", e, file=sys.stderr)

    write_json("news.json", {"updated": now_iso(), "brief": brief, "items": items[:120]})
    print(f"news: {len(items)} items, brief {len(brief)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
