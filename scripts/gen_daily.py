"""產生每日副業發想、每日想法、每日鼓勵 → data/daily.json
有 ANTHROPIC_API_KEY 時由 Claude 生成（並避開最近 60 天的重複題目），否則從 scripts/pool.json 輪播。"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from common import claude_client, claude_json, now_iso, read_json, write_json

TPE = timezone(timedelta(hours=8))
POOL = json.loads((Path(__file__).parent / "pool.json").read_text(encoding="utf-8"))

# 商業頭腦／心理學每日一課的格式
LESSON = {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "concept": {"type": "string"},
                    "example": {"type": "string"},
                    "apply": {"type": "string"},
                    "question": {"type": "string"},
                    "answer": {"type": "string"},
                },
                "required": ["title", "concept", "example", "apply", "question", "answer"],
                "additionalProperties": False,
            }

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
        "learning": {
            "type": "object",
            "properties": {
                "category": {"type": "string"},
                "title": {"type": "string"},
                "content": {"type": "string"},
                "examples": {"type": "array", "items": {"type": "string"}},
                "practice": {"type": "string"},
                "answer": {"type": "string"},
            },
            "required": ["category", "title", "content", "examples", "practice", "answer"],
            "additionalProperties": False,
        },
        "mind": {
            "type": "object",
            "properties": {"business": LESSON, "psychology": LESSON},
            "required": ["business", "psychology"],
            "additionalProperties": False,
        },
        "encouragement": {
            "type": "object",
            "properties": {"text": {"type": "string"}, "author": {"type": "string"}},
            "required": ["text", "author"],
            "additionalProperties": False,
        },
    },
    "required": ["side_hustle", "idea", "learning", "mind", "encouragement"],
    "additionalProperties": False,
}


# 每日學習依星期輪替主題（週一=0）
LEARN_TOPICS = ["英文", "日文", "實用技能", "英文", "邏輯思考", "理財知識", "冷知識・科學"]


def from_pool(day: datetime) -> dict:
    n = day.toordinal()
    pick = lambda arr, k=1: arr[(n * k) % len(arr)]  # noqa: E731
    return {
        "side_hustle": pick(POOL["side_hustles"]),
        "idea": pick(POOL["ideas"], 7),
        "mind": {
            "business": pick(POOL["business_lessons"], 5),
            "psychology": pick(POOL["psychology_lessons"], 11),
        },
        "learning": next((x for x in POOL["learnings"][n % len(POOL["learnings"]):] + POOL["learnings"]
                          if x["category"] == LEARN_TOPICS[day.weekday()]), pick(POOL["learnings"])),
        "encouragement": pick(POOL["encouragements"], 3),
    }


def main() -> int:
    today = datetime.now(TPE)
    history = read_json("history.json", {})
    for k in ("side_hustles", "ideas", "learnings", "business", "psychology"):
        history.setdefault(k, [])
    topic = LEARN_TOPICS[today.weekday()]
    content, generator = None, "pool"
    ai_status = "no_key（沒有讀到 ANTHROPIC_API_KEY）"

    client = claude_client()
    if client:
        avoid = "、".join(history["side_hustles"][-60:] + history["ideas"][-60:]) or "（無）"
        avoid_learn = "、".join(history["learnings"][-60:]) or "（無）"
        avoid_mind = "、".join(history["business"][-60:] + history["psychology"][-60:]) or "（無）"
        prompt = f"""今天是 {today:%Y-%m-%d}（{"一二三四五六日"[today.weekday()]}）。請為一位住在台灣、上班族、想增加收入與資產的人產生今天的內容，全部使用繁體中文（台灣用語）：

1. side_hustle：一個具體可執行的副業發想。summary 2–3 句說明是什麼、為什麼現在適合；steps 3–5 個「這週就能開始」的具體步驟；startup_cost、time_needed（每週時數）、potential（合理的月收入範圍，不誇大）。
2. idea：一個想法，type 二選一：「今天可以做的事」（具體小行動，例如整理某項支出、學一個技能）或「增加資產的想法」（理財、投資、提升能力或被動收入的方向）。detail 3–4 句、具體可行。
3. learning：今天的「每日學習」，主題是「{topic}」，category 填「{topic}」。挑一個 5 分鐘內學得會、生活或工作用得到的小東西：
   - 英文／日文：一個實用句型、片語或易混淆用法（例如 affect vs effect），content 說明意思與用法，examples 2–3 個例句（附中文翻譯）
   - 實用技能：一個具體技巧（Excel 函數、手機設定、溝通技巧、AI 工具用法等），examples 寫操作步驟
   - 邏輯思考：一個思考框架、常見謬誤或一道小推理題，examples 寫應用情境
   - 理財知識：一個觀念（例如複利、ETF 內扣費用、緊急預備金），examples 用台灣情境舉例、附數字
   - 冷知識・科學：一個有趣且正確的知識，examples 補充細節
   content 3–4 句；practice 是一題能自我檢查的小練習；answer 是解答與簡短說明。內容必須正確，不確定的不要寫。
   避免與最近學過的重複：{avoid_learn}
4. mind：「商業頭腦」與「心理學」各一課（business、psychology），讓人每天 5 分鐘累積判斷力：
   - business：商業思維，例如商業模式、定價、單位經濟、護城河、行銷漏斗、談判、現金流、機會成本、看懂財報的一個指標、經典企業案例的關鍵決策
   - psychology：實用心理學，例如認知偏誤、說服與影響力、動機與習慣、情緒調節、人際溝通、決策心理、消費者心理
   每課：title 概念名稱（可附英文原名）；concept 3–4 句白話解釋；example 一個具體例子或真實案例（台灣或國際皆可，引用真實公司或研究時內容必須正確，不確定就用虛構情境並寫明「舉例來說」）；apply 今天就能用在工作、副業或生活的一個具體做法；question 一個思考題；answer 參考解答。
   兩課都避免與最近學過的重複：{avoid_mind}
5. encouragement：一句溫暖、不老套的每日鼓勵。可以是名人名言（author 填真實出處）或原創（author 填「今日寄語」）。不要捏造名人說過的話。

避免與最近用過的題目重複：{avoid}"""
        try:
            content, generator = claude_json(client, prompt, SCHEMA), "claude"
            ai_status = "ok"
        except Exception as e:  # noqa: BLE001
            print("WARN claude:", e, file=sys.stderr)
            ai_status = f"error: {type(e).__name__}: {str(e)[:300]}"
    if content is None:
        content = from_pool(today)

    history["side_hustles"] = (history["side_hustles"] + [content["side_hustle"]["title"]])[-90:]
    history["ideas"] = (history["ideas"] + [content["idea"]["title"]])[-90:]
    history["learnings"] = (history["learnings"] + [content["learning"]["title"]])[-90:]
    history["business"] = (history["business"] + [content["mind"]["business"]["title"]])[-90:]
    history["psychology"] = (history["psychology"] + [content["mind"]["psychology"]["title"]])[-90:]
    write_json("history.json", history)
    write_json("daily.json", {"date": f"{today:%Y-%m-%d}", "updated": now_iso(), "generator": generator, "ai_status": ai_status, **content})
    print(f"daily: {generator} – {content['side_hustle']['title']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
