"""產生每日副業發想、每日想法、每日鼓勵 → data/daily.json
有 ANTHROPIC_API_KEY 時由 Claude 生成（並避開最近 60 天的重複題目），否則從 scripts/pool.json 輪播。"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from common import claude_client, claude_json, now_iso, read_json, write_json

TPE = timezone(timedelta(hours=8))
POOL = json.loads((Path(__file__).parent / "pool.json").read_text(encoding="utf-8"))

SCHEMA = {
    "type": "object",
    "properties": {
        "side_hustle": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "steps": {"type": "array", "items": {"type": "string"}},
                "startup_cost": {"type": "string"},
                "time_needed": {"type": "string"},
                "potential": {"type": "string"},
            },
            "required": ["title", "summary", "steps", "startup_cost", "time_needed", "potential"],
            "additionalProperties": False,
        },
        "idea": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["今天可以做的事", "增加資產的想法"]},
                "title": {"type": "string"},
                "detail": {"type": "string"},
            },
            "required": ["type", "title", "detail"],
            "additionalProperties": False,
        },
        "encouragement": {
            "type": "object",
            "properties": {"text": {"type": "string"}, "author": {"type": "string"}},
            "required": ["text", "author"],
            "additionalProperties": False,
        },
    },
    "required": ["side_hustle", "idea", "encouragement"],
    "additionalProperties": False,
}


def from_pool(day: datetime) -> dict:
    n = day.toordinal()
    pick = lambda arr, k=1: arr[(n * k) % len(arr)]  # noqa: E731
    return {
        "side_hustle": pick(POOL["side_hustles"]),
        "idea": pick(POOL["ideas"], 7),
        "encouragement": pick(POOL["encouragements"], 3),
    }


def main() -> int:
    today = datetime.now(TPE)
    history = read_json("history.json", {"side_hustles": [], "ideas": []})
    content, generator = None, "pool"

    client = claude_client()
    if client:
        avoid = "、".join(history["side_hustles"][-60:] + history["ideas"][-60:]) or "（無）"
        prompt = f"""今天是 {today:%Y-%m-%d}（{"一二三四五六日"[today.weekday()]}）。請為一位住在台灣、上班族、想增加收入與資產的人產生今天的內容，全部使用繁體中文（台灣用語）：

1. side_hustle：一個具體可執行的副業發想。summary 2–3 句說明是什麼、為什麼現在適合；steps 3–5 個「這週就能開始」的具體步驟；startup_cost、time_needed（每週時數）、potential（合理的月收入範圍，不誇大）。
2. idea：一個想法，type 二選一：「今天可以做的事」（具體小行動，例如整理某項支出、學一個技能）或「增加資產的想法」（理財、投資、提升能力或被動收入的方向）。detail 3–4 句、具體可行。
3. encouragement：一句溫暖、不老套的每日鼓勵。可以是名人名言（author 填真實出處）或原創（author 填「今日寄語」）。不要捏造名人說過的話。

避免與最近用過的題目重複：{avoid}"""
        try:
            content, generator = claude_json(client, prompt, SCHEMA), "claude"
        except Exception as e:  # noqa: BLE001
            print("WARN claude:", e, file=sys.stderr)
    if content is None:
        content = from_pool(today)

    history["side_hustles"] = (history["side_hustles"] + [content["side_hustle"]["title"]])[-90:]
    history["ideas"] = (history["ideas"] + [content["idea"]["title"]])[-90:]
    write_json("history.json", history)
    write_json("daily.json", {"date": f"{today:%Y-%m-%d}", "updated": now_iso(), "generator": generator, **content})
    print(f"daily: {generator} – {content['side_hustle']['title']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
