"""清醒行動派：後台「記錄」分頁送來的一筆資料，寫進 Notion（成長數據或收入記錄）。

由 .github/workflows/qingxing-record.yml 在 repository_dispatch（event_type=qx-record）時執行。
環境變數：
  NOTION_TOKEN   Notion integration token
  RECORD_JSON    client_payload 的 JSON 字串。新格式是 {"kind":"growth","data":{...其餘欄位}}
                 （GitHub 規定 client_payload 頂層最多 10 個欄位）；舊的攤平格式也照收。攤平後例如
                 {"kind":"growth","date":"2026-11-10","platform":"Instagram","followers":12,"views":340,
                  "likes":20,"comments":3,"saves":5,"shares":1,"topic":"Day 1 迷惘不是你的問題","format":"輪播","note":""}
                 {"kind":"income","date":"2026-11-19","product":"電子書《從迷惘到行動》","qty":1,"unit":390,"amount":390,
                  "channel":"Portaly","source":"IG","note":""}
寫完後由 workflow 接著跑 fetch_qingxing.py 重新同步。
"""
import json
import os
import sys

import requests

GROWTH_DB = "c6c1c75e84454b7f9e4fe7fa73fcdd5e"
INCOME_DB = "68fe898d466e4538ac2686aa8b629dd9"
TOKEN = os.environ.get("NOTION_TOKEN", "")
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}

GROWTH_PLATFORMS = {"Instagram", "抖音", "Threads"}
GROWTH_FORMATS = {"輪播", "Reels", "單圖", "限動"}
PRODUCTS = {"電子書《從迷惘到行動》", "Notion 清醒行動系統", "電子書+Notion系統組合", "進階版", "陪跑服務", "團體方案", "其他"}
CHANNELS = {"Gumroad", "Portaly", "轉帳", "其他"}
SOURCES = {"IG", "抖音", "Email", "推薦", "其他"}


def num(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def title(s): return {"title": [{"text": {"content": str(s)[:200]}}]}
def text(s): return {"rich_text": [{"text": {"content": str(s)[:2000]}}]} if s else {"rich_text": []}
def number(v): return {"number": num(v)}
def select(v, allowed, default=None):
    v = v if v in allowed else default
    return {"select": {"name": v}} if v else {"select": None}
def date(s): return {"date": {"start": str(s)[:10]}}


PLATFORM_ALIASES = {"TikTok": "抖音", "TikTok（抖音）": "抖音", "tiktok": "抖音", "IG": "Instagram", "instagram": "Instagram"}


def flatten(rec: dict) -> dict:
    """新格式 {kind, data:{...}} → 攤平成一層。"""
    if isinstance(rec.get("data"), dict):
        return {**rec["data"], "kind": rec.get("kind")}
    return rec


def build(rec: dict):
    rec = flatten(rec)
    if rec.get("platform") in PLATFORM_ALIASES:
        rec["platform"] = PLATFORM_ALIASES[rec["platform"]]
    if rec.get("source") in ("TikTok", "tiktok", "TikTok（抖音）"):
        rec["source"] = "抖音"
    kind = rec.get("kind")
    d = rec.get("date")
    if not d or len(str(d)) < 10:
        raise ValueError("缺日期")
    if kind == "growth":
        platform = rec.get("platform")
        if platform not in GROWTH_PLATFORMS:
            raise ValueError(f"不認得的平台：{platform}")  # 不要默默記成 Instagram
        short = {"Instagram": "IG", "抖音": "TikTok", "Threads": "Threads"}[platform]
        props = {
            "名稱": title(rec.get("name") or f"{d[5:].replace('-', '/')} {short}"),
            "日期": date(d),
            "平台": select(platform, GROWTH_PLATFORMS),
            "粉絲數": number(rec.get("followers")),
            "觀看數": number(rec.get("views")),
            "按讚": number(rec.get("likes")),
            "留言": number(rec.get("comments")),
            "收藏": number(rec.get("saves")),
            "分享": number(rec.get("shares")),
            "發文主題": text(rec.get("topic")),
            "格式": select(rec.get("format"), GROWTH_FORMATS),
            "備註": text(rec.get("note")),
        }
        return GROWTH_DB, props
    if kind == "income":
        qty = num(rec.get("qty")) or 1
        unit = num(rec.get("unit"))
        amount = num(rec.get("amount"))
        if amount is None and unit is not None:
            amount = unit * qty
        if amount is None:
            raise ValueError("缺金額")
        product = rec.get("product") if rec.get("product") in PRODUCTS else "其他"
        props = {
            "項目": title(rec.get("item") or f"{product} ×{int(qty) if qty == int(qty) else qty}"),
            "日期": date(d),
            "產品": select(product, PRODUCTS),
            "數量": number(qty),
            "單價": number(unit if unit is not None else amount / qty),
            "金額": number(amount),
            "收款平台": select(rec.get("channel"), CHANNELS),
            "來源": select(rec.get("source"), SOURCES),
            "備註": text(rec.get("note")),
        }
        return INCOME_DB, props
    raise ValueError(f"不認得的 kind：{kind}")


def main() -> int:
    if not TOKEN:
        print("::error::沒有 NOTION_TOKEN", file=sys.stderr); return 1
    raw = os.environ.get("RECORD_JSON", "")
    try:
        rec = json.loads(raw)
    except json.JSONDecodeError:
        print("::error::RECORD_JSON 不是合法 JSON", file=sys.stderr); return 1
    recs = rec if isinstance(rec, list) else [rec]
    ok = 0
    for r in recs:
        try:
            db, props = build(r)
        except ValueError as e:
            print(f"::warning::略過一筆：{e}", file=sys.stderr); continue
        resp = requests.post("https://api.notion.com/v1/pages", headers=HEADERS,
                             json={"parent": {"database_id": db}, "properties": props}, timeout=30)
        if resp.status_code >= 300:
            print(f"::error::Notion 回應 {resp.status_code}：{resp.text[:300]}", file=sys.stderr); return 1
        ok += 1
        f = flatten(r)
        print(f"已寫入 {f.get('kind')} {f.get('date')} {f.get('platform', '')}")
    print(f"完成 {ok}/{len(recs)} 筆")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
