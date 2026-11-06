"""清醒行動派：從 Notion 兩個資料庫（成長數據、收入記錄）同步到 qingxing/data.json。

需要環境變數 NOTION_TOKEN（Notion integration token），
且兩個資料庫都要在 Notion 裡「連接」給該 integration。
沒有 token 時保留現有 data.json，只更新 generatedAt 與狀態。
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qingxing" / "data.json"

GROWTH_DB = os.environ.get("NOTION_GROWTH_DB", "c6c1c75e84454b7f9e4fe7fa73fcdd5e")
INCOME_DB = os.environ.get("NOTION_INCOME_DB", "68fe898d466e4538ac2686aa8b629dd9")
TOKEN = os.environ.get("NOTION_TOKEN", "")
TPE = timezone(timedelta(hours=8))

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}


def query_all(db_id: str) -> list[dict]:
    rows, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        r = requests.post(f"https://api.notion.com/v1/databases/{db_id}/query", headers=HEADERS, json=body, timeout=30)
        r.raise_for_status()
        j = r.json()
        rows += j.get("results", [])
        if not j.get("has_more"):
            return rows
        cursor = j.get("next_cursor")


def prop(p: dict, name: str):
    v = p.get(name)
    if not v:
        return None
    t = v.get("type")
    if t == "title":
        return "".join(x.get("plain_text", "") for x in v["title"])
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in v["rich_text"])
    if t == "number":
        return v["number"]
    if t == "select":
        return v["select"]["name"] if v["select"] else None
    if t == "date":
        return v["date"]["start"][:10] if v["date"] else None
    if t == "formula":
        f = v["formula"]
        return f.get(f.get("type"))
    return None


def n(x):
    return float(x) if isinstance(x, (int, float)) else 0.0


def main() -> int:
    prev = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "brand": "清醒行動派",
        "growth": prev.get("growth", []),
        "income": prev.get("income", []),
        "monthly": prev.get("monthly", []),
        "status": "ok",
    }
    if not TOKEN:
        out["status"] = "no_token"
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("沒有 NOTION_TOKEN，保留舊資料")
        return 0

    try:
        growth = []
        for pg in query_all(GROWTH_DB):
            p = pg["properties"]
            d = prop(p, "日期")
            if not d:
                continue
            likes, comments, saves, shares = (n(prop(p, k)) for k in ("按讚", "留言", "收藏", "分享"))
            growth.append({
                "date": d,
                "platform": prop(p, "平台") or "Instagram",
                "followers": n(prop(p, "粉絲數")),
                "views": n(prop(p, "觀看數")),
                "likes": likes, "comments": comments, "saves": saves, "shares": shares,
                "heat": likes + comments * 3 + saves * 5 + shares * 5,
                "topic": prop(p, "發文主題") or "",
                "format": prop(p, "格式") or "",
            })
        growth.sort(key=lambda r: (r["date"], r["platform"]))

        income = []
        for pg in query_all(INCOME_DB):
            p = pg["properties"]
            d = prop(p, "日期")
            if not d:
                continue
            income.append({
                "date": d,
                "item": prop(p, "項目") or "",
                "product": prop(p, "產品") or "其他",
                "qty": n(prop(p, "數量")) or 1,
                "unit": n(prop(p, "單價")),
                "amount": n(prop(p, "金額")),
                "channel": prop(p, "收款平台") or "",
                "source": prop(p, "來源") or "",
                "note": prop(p, "備註") or "",
            })
        income.sort(key=lambda r: r["date"])

        monthly = defaultdict(lambda: {"month": "", "revenue": 0.0, "orders": 0, "byProduct": defaultdict(float)})
        for r in income:
            m = r["date"][:7]
            monthly[m]["month"] = m
            monthly[m]["revenue"] += r["amount"]
            monthly[m]["orders"] += int(r["qty"])
            monthly[m]["byProduct"][r["product"]] += r["amount"]
        out["monthly"] = [
            {**v, "byProduct": dict(v["byProduct"])} for _, v in sorted(monthly.items())
        ]
        out["growth"], out["income"] = growth, income
    except requests.HTTPError as e:
        out["status"] = f"notion_error {e.response.status_code}"
        print("Notion 回應錯誤：", e.response.status_code, e.response.text[:300], file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        out["status"] = f"error {type(e).__name__}"
        print("同步失敗：", e, file=sys.stderr)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"成長 {len(out['growth'])} 筆、收入 {len(out['income'])} 筆、狀態 {out['status']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
