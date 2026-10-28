"""抓取國際與財經新聞 RSS → data/news.json；有 ANTHROPIC_API_KEY 時另外產生兩類的繁中重點摘要"""
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
                "category": feed.get("category", "國際"),
                "lang": feed["lang"],
                "published": pub,
                "summary": (e.get("summary") or "")[:300],
            })
    if not items:
        print("no news fetched", file=sys.stderr)
        return 1
    items.sort(key=lambda i: i["published"] or "", reverse=True)

    briefs = {"國際": [], "財經": []}
    ai_status = "no_key"
    client = claude_client()
    if client:
        def headlines(cat):
            return "\n".join(f"- [{i['source']}] {i['title']}" for i in [x for x in items if x["category"] == cat][:80])

        try:
            res = claude_json(
                client,
                "以下是過去一天的新聞標題，分成國際與財經兩類。請各挑出最重要的 6 則，"
                "各用一句繁體中文（台灣用語，45 字內）說明發生什麼事與為何重要；重複報導合併，不要逐條翻譯標題。"
                "財經類著重市場走勢、央行與利率、重要企業與產業、對台灣投資人的影響。\n\n"
                f"【國際】\n{headlines('國際')}\n\n【財經】\n{headlines('財經')}",
                {
                    "type": "object",
                    "properties": {
                        "world": {"type": "array", "items": {"type": "string"}},
                        "finance": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["world", "finance"],
                    "additionalProperties": False,
                },
            )
            briefs = {"國際": res["world"], "財經": res["finance"]}
            ai_status = "ok"
        except Exception as e:  # noqa: BLE001 - summary is optional
            print("WARN brief:", e, file=sys.stderr)
            ai_status = f"error: {type(e).__name__}: {str(e)[:300]}"

    # 每類各保留最新 80 則
    kept = [i for cat in ("國際", "財經") for i in [x for x in items if x["category"] == cat][:80]]
    kept.sort(key=lambda i: i["published"] or "", reverse=True)
    write_json("news.json", {"updated": now_iso(), "brief": briefs["國際"], "briefs": briefs, "ai_status": ai_status, "items": kept})
    print(f"news: {len(kept)} items, briefs {[len(v) for v in briefs.values()]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
