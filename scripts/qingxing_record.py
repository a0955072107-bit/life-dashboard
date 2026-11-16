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
修改：data 裡帶 "id"（Notion 頁面 id，後台點一筆紀錄會帶上）→ 直接改那一頁，空白欄位會清空。
沒帶 id 的成長數據：同日期＋同平台已經有一筆 → 只用有填的欄位更新那一筆（不會重複新增）；沒有才新增。
刪除：{"kind":"delete","data":{"id":"<Notion 頁面 id>","target":"growth"|"income"}} → 把那一頁 archive（Notion 垃圾桶可還原，不會真的刪掉）；
      只允許 archive 屬於「成長數據」或「收入記錄」的頁面。
防重複：成長數據新增後再查一次同日期＋同平台；同時送出好幾筆造成兩頁以上時，保留最早建立的那頁、
      把較新那頁有填的欄位併進去，再 archive 較新的頁面。
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


def find_growth(date: str, platform: str):
    """同日期同平台的成長數據頁面 id（沒有回 None）。"""
    body = {"filter": {"and": [
        {"property": "日期", "date": {"equals": date}},
        {"property": "平台", "select": {"equals": platform}},
    ]}, "page_size": 5}
    res = query_same(date, platform)
    return res[0]["id"] if res else None


EMPTY_KEYS = {"followers": "粉絲數", "views": "觀看數", "likes": "按讚", "comments": "留言", "saves": "收藏",
              "shares": "分享", "topic": "發文主題", "note": "備註", "format": "格式"}
NUM_PROPS = ("粉絲數", "觀看數", "按讚", "留言", "收藏", "分享")
TEXT_PROPS = ("發文主題", "備註")


def norm_id(s: str) -> str:
    return (s or "").replace("-", "").lower()


def archive(page_id: str, target: str) -> None:
    """只 archive 屬於成長數據／收入記錄的頁面。"""
    r = requests.get(f"https://api.notion.com/v1/pages/{page_id}", headers=HEADERS, timeout=30)
    r.raise_for_status()
    parent = norm_id((r.json().get("parent") or {}).get("database_id"))
    allowed = {"growth": GROWTH_DB, "income": INCOME_DB}.get(target)
    if not allowed or parent != norm_id(allowed):
        raise ValueError(f"這一頁不屬於{target}資料庫，不刪")
    resp = requests.patch(f"https://api.notion.com/v1/pages/{page_id}", headers=HEADERS, json={"archived": True}, timeout=30)
    resp.raise_for_status()


def query_same(date: str, platform: str) -> list:
    body = {"filter": {"and": [
        {"property": "日期", "date": {"equals": date}},
        {"property": "平台", "select": {"equals": platform}},
    ]}, "sorts": [{"timestamp": "created_time", "direction": "ascending"}], "page_size": 20}
    r = requests.post(f"https://api.notion.com/v1/databases/{GROWTH_DB}/query", headers=HEADERS, json=body, timeout=30)
    r.raise_for_status()
    return r.json().get("results", [])


def dedupe(date: str, platform: str) -> int:
    """同日同平台超過一頁：保留最早建立的，把較新頁面有填的欄位併進去，再 archive 較新的。回傳 archive 了幾頁。"""
    pages = query_same(date, platform)
    if len(pages) < 2:
        return 0
    keep, extras = pages[0], pages[1:]
    merged = {}
    for pg in extras:  # 照建立時間，較新的蓋較舊的
        pr = pg.get("properties", {})
        for name in NUM_PROPS:
            v = (pr.get(name) or {}).get("number")
            if v is not None:
                merged[name] = {"number": v}
        for name in TEXT_PROPS:
            rt = (pr.get(name) or {}).get("rich_text") or []
            t = "".join(x.get("plain_text", "") for x in rt)
            if t:
                merged[name] = text(t)
        sel = ((pr.get("格式") or {}).get("select") or {}).get("name")
        if sel:
            merged["格式"] = {"select": {"name": sel}}
    if merged:
        requests.patch(f"https://api.notion.com/v1/pages/{keep['id']}", headers=HEADERS,
                       json={"properties": merged}, timeout=30).raise_for_status()
    n = 0
    for pg in extras:
        r = requests.patch(f"https://api.notion.com/v1/pages/{pg['id']}", headers=HEADERS, json={"archived": True}, timeout=30)
        if r.status_code < 300 or r.status_code == 400:  # 400：可能已被另一個同時跑的 run archive 了
            n += 1
    print(f"同日同平台有 {len(pages)} 頁，已合併到最早那頁並 archive {n} 頁")
    return n


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
        f0 = flatten(r)
        if f0.get("kind") == "delete":
            pid = (f0.get("id") or "").strip()
            try:
                if not pid:
                    raise ValueError("刪除缺 id")
                archive(pid, f0.get("target"))
            except (ValueError, requests.RequestException) as e:
                print(f"::error::刪除失敗：{e}", file=sys.stderr); return 1
            ok += 1
            print(f"已刪除（archive）{f0.get('target')} {f0.get('date', '')} {f0.get('platform', '')}")
            continue
        try:
            db, props = build(r)
        except ValueError as e:
            print(f"::warning::略過一筆：{e}", file=sys.stderr); continue
        f = flatten(r)
        page_id = (f.get("id") or "").strip()
        action = "已修改" if page_id else "已寫入"
        if not page_id and f.get("kind") == "growth":
            try:
                page_id = find_growth(props["日期"]["date"]["start"], props["平台"]["select"]["name"])
            except requests.RequestException as e:
                print(f"::warning::查重複失敗（{e}），改成新增", file=sys.stderr)
                page_id = None
            if page_id:
                action = "已更新同日同平台那一筆"
                # 沒填的欄位不要蓋掉舊值
                for k, name in EMPTY_KEYS.items():
                    if str(f.get(k) or "").strip() == "":
                        props.pop(name, None)
                props.pop("名稱", None)
        if page_id:
            resp = requests.patch(f"https://api.notion.com/v1/pages/{page_id}", headers=HEADERS,
                                  json={"properties": props}, timeout=30)
        else:
            resp = requests.post("https://api.notion.com/v1/pages", headers=HEADERS,
                                 json={"parent": {"database_id": db}, "properties": props}, timeout=30)
        if resp.status_code >= 300:
            print(f"::error::Notion 回應 {resp.status_code}：{resp.text[:300]}", file=sys.stderr); return 1
        ok += 1
        print(f"{action} {f.get('kind')} {f.get('date')} {f.get('platform', '')}")
        if f.get("kind") == "growth" and not f.get("id"):
            try:
                dedupe(props["日期"]["date"]["start"], props["平台"]["select"]["name"])
            except requests.RequestException as e:
                print(f"::warning::檢查重複失敗：{e}", file=sys.stderr)
    print(f"完成 {ok}/{len(recs)} 筆")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
