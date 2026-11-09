"""清醒行動派：每晚自動抓 IG 與 Threads 的數據寫進 Notion。

兩層：
  1. 「貼文成效」資料庫：每一篇貼文一列（IG 圖卡、IG Reel、Threads 每一則），最近 LOOKBACK_DAYS 天發的每晚更新數字
     （貼文發出後幾天還會繼續長），用貼文 ID 判斷同一篇。
  2. 「成長數據」資料庫：每天每平台一列，粉絲數＝現在的累計追蹤數，觀看／互動＝那一天發的貼文加總。

環境變數：
  IG_ACCESS_TOKEN       IG 權杖（EAA… 走 graph.facebook.com；IGAA… 走 graph.instagram.com）
  IG_USER_ID            IG 帳號 ID（EAA 權杖必填）
  THREADS_ACCESS_TOKEN  Threads 權杖（要有 threads_basic、threads_manage_insights）
  NOTION_TOKEN          Notion integration token（成長數據、貼文成效兩個資料庫都要連接給它）
  TARGET_DATE           每日那筆要記錄哪一天（台北，YYYY-MM-DD）。預設今天；凌晨 3 點前執行算前一天
  LOOKBACK_DAYS         每篇貼文往回更新幾天，預設 7
  DRY_RUN=true          只印出數字，不寫 Notion
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

TPE = timezone(timedelta(hours=8))
GROWTH_DB = "c6c1c75e84454b7f9e4fe7fa73fcdd5e"
POSTS_DB = os.environ.get("NOTION_POSTS_DB", "c14dd2984bc14ec488fc79c5645539b8")
NOTION = {"Authorization": f"Bearer {os.environ.get('NOTION_TOKEN','')}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
DRY = os.environ.get("DRY_RUN") == "true"
LOOKBACK = int(os.environ.get("LOOKBACK_DAYS") or 7)
ROOT = Path(__file__).resolve().parent.parent
SCHEDULE = ROOT / "qingxing" / "schedule.json"
IG_POSTS_DIR = ROOT / "qingxing" / "instagram" / "posts"
THREADS_JSON = ROOT / "qingxing" / "threads" / "posts.json"
NOW = datetime.now(TPE)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def tpe_date(ts: str) -> str:
    ts = ts.replace("Z", "+00:00")
    ts = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", ts)
    return datetime.fromisoformat(ts).astimezone(TPE).strftime("%Y-%m-%d")


def get(url, **params):
    r = requests.get(url, params=params, timeout=30)
    j = r.json()
    if r.status_code >= 300 or "error" in j:
        raise RuntimeError(f"{r.status_code}: {(j.get('error') or {}).get('message', j)}")
    return j


# ---------- 對照：哪一篇是 Day 幾、Threads 哪一個時段 ----------
def schedule_titles() -> dict:
    try:
        return {p["date"]: (p["day"], p["title"]) for p in json.loads(SCHEDULE.read_text(encoding="utf-8"))}
    except Exception:  # noqa: BLE001
        return {}


def threads_lookup() -> dict:
    """Threads 文字前 40 字 → (day, slot)"""
    try:
        return {norm(t["text"])[:40]: (t["day"], t["slot"]) for t in json.loads(THREADS_JSON.read_text(encoding="utf-8"))}
    except Exception:  # noqa: BLE001
        return {}


TITLES = schedule_titles()
TH_LOOKUP = threads_lookup()


# ---------- IG ----------
def ig_collect():
    tok = os.environ.get("IG_ACCESS_TOKEN", "")
    if not tok:
        return None
    if tok.startswith("EAA"):
        base, uid = "https://graph.facebook.com/v21.0", os.environ.get("IG_USER_ID", "")
        if not uid:
            raise RuntimeError("EAA 權杖需要 IG_USER_ID")
    else:
        base = "https://graph.instagram.com/v21.0"
        uid = get(f"{base}/me", fields="user_id,id", access_token=tok).get("user_id") or "me"
    prof = get(f"{base}/{uid}", fields="followers_count,username", access_token=tok)
    media = get(f"{base}/{uid}/media", fields="id,timestamp,media_type,media_product_type,like_count,comments_count,caption,permalink",
                limit=30, access_token=tok).get("data", [])
    since = (NOW - timedelta(days=LOOKBACK)).strftime("%Y-%m-%d")
    posts = []
    for m in media:
        d = tpe_date(m["timestamp"])
        if d < since:
            continue
        reel = m.get("media_product_type") == "REELS" or m.get("media_type") == "VIDEO"
        row = {"id": m["id"], "platform": "Instagram", "date": d, "type": "Reel" if reel else "圖卡",
               "views": 0, "likes": m.get("like_count") or 0, "comments": m.get("comments_count") or 0,
               "saves": 0, "shares": 0, "link": m.get("permalink"), "text": m.get("caption") or ""}
        for metrics in (("views", "reach", "saved", "shares"), ("reach", "saved", "shares"), ("saved",)):
            try:
                ins = get(f"{base}/{m['id']}/insights", metric=",".join(metrics), access_token=tok).get("data", [])
                vals = {x["name"]: (x.get("values") or [{}])[0].get("value", 0) or 0 for x in ins}
                row["views"] = vals.get("views") or vals.get("reach") or 0
                row["saves"], row["shares"] = vals.get("saved", 0), vals.get("shares", 0)
                break
            except RuntimeError:
                continue
        day = TITLES.get(d, (None, ""))
        row["day"], row["title"] = day[0], f"{'Reel' if reel else '圖卡'}｜Day {day[0]} {day[1]}" if day[0] is not None else norm(row["text"])[:30]
        posts.append(row)
    return {"followers": prof.get("followers_count", 0), "posts": posts}


# ---------- Threads ----------
def threads_collect():
    tok = os.environ.get("THREADS_ACCESS_TOKEN", "")
    if not tok:
        return None
    base = "https://graph.threads.net/v1.0"
    followers = 0
    try:
        for x in get(f"{base}/me/threads_insights", metric="followers_count", access_token=tok).get("data", []):
            followers = (x.get("total_value") or {}).get("value") or (x.get("values") or [{}])[-1].get("value", 0) or 0
    except RuntimeError as e:
        print(f"::warning::Threads 粉絲數讀不到（{e}），填 0", file=sys.stderr)
    items = get(f"{base}/me/threads", fields="id,timestamp,text,permalink,media_type,is_quote_post", limit=50, access_token=tok).get("data", [])
    since = (NOW - timedelta(days=LOOKBACK)).strftime("%Y-%m-%d")
    posts = []
    for t in items:
        d = tpe_date(t["timestamp"])
        if d < since or t.get("media_type") == "REPOST_FACADE":
            continue
        row = {"id": t["id"], "platform": "Threads", "date": d, "views": 0, "likes": 0, "comments": 0, "saves": 0, "shares": 0,
               "link": t.get("permalink"), "text": t.get("text") or ""}
        try:
            ins = get(f"{base}/{t['id']}/insights", metric="views,likes,replies,reposts,quotes", access_token=tok).get("data", [])
            v = {x["name"]: (x.get("values") or [{}])[0].get("value", 0) or 0 for x in ins}
            row.update(views=v.get("views", 0), likes=v.get("likes", 0), comments=v.get("replies", 0), shares=v.get("reposts", 0) + v.get("quotes", 0))
        except RuntimeError as e:
            print(f"::warning::Threads {t['id']} insights 讀不到：{e}", file=sys.stderr)
        day, slot = TH_LOOKUP.get(norm(row["text"])[:40], (None, None))
        row["type"] = f"Threads {slot}" if slot else "Threads"
        row["day"] = day
        row["title"] = f"Threads {slot}｜Day {day}" if slot else (norm(row["text"])[:30] or "（沒有文字）")
        posts.append(row)
    return {"followers": followers, "posts": posts}


# ---------- Notion ----------
def notion(method, url, body=None):
    r = requests.request(method, url, headers=NOTION, json=body, timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"Notion {r.status_code}: {r.text[:300]}")
    return r.json()


def upsert_post(p: dict):
    props = {
        "貼文": {"title": [{"text": {"content": p["title"][:200]}}]},
        "日期": {"date": {"start": p["date"]}},
        "平台": {"select": {"name": p["platform"]}},
        "類型": {"select": {"name": p["type"]}},
        "觀看數": {"number": p["views"]}, "按讚": {"number": p["likes"]}, "留言": {"number": p["comments"]},
        "收藏": {"number": p["saves"]}, "分享": {"number": p["shares"]},
        "貼文ID": {"rich_text": [{"text": {"content": p["id"]}}]},
        "更新時間": {"rich_text": [{"text": {"content": NOW.strftime("%m/%d %H:%M")}}]},
    }
    if p.get("day") is not None:
        props["Day"] = {"number": p["day"]}
    if p.get("link"):
        props["連結"] = {"url": p["link"]}
    if DRY:
        print(f"[試跑] {p['date']} {p['title']}：觀看 {p['views']}、讚 {p['likes']}、留言 {p['comments']}、收藏 {p['saves']}、分享 {p['shares']}")
        return
    found = notion("POST", f"https://api.notion.com/v1/databases/{POSTS_DB}/query",
                   {"filter": {"property": "貼文ID", "rich_text": {"equals": p["id"]}}, "page_size": 1}).get("results", [])
    if found:
        notion("PATCH", f"https://api.notion.com/v1/pages/{found[0]['id']}", {"properties": props})
    else:
        notion("POST", "https://api.notion.com/v1/pages", {"parent": {"database_id": POSTS_DB}, "properties": props})


def upsert_daily(date: str, platform: str, followers: int, posts: list):
    todays = [p for p in posts if p["date"] == date]
    agg = {k: sum(p[k] for p in todays) for k in ("views", "likes", "comments", "saves", "shares")}
    short = {"Instagram": "IG", "Threads": "Threads"}[platform]
    props = {
        "日期": {"date": {"start": date}},
        "平台": {"select": {"name": platform}},
        "粉絲數": {"number": followers},
        "觀看數": {"number": agg["views"]}, "按讚": {"number": agg["likes"]}, "留言": {"number": agg["comments"]},
        "收藏": {"number": agg["saves"]}, "分享": {"number": agg["shares"]},
        "備註": {"rich_text": [{"text": {"content": f"自動抓取 {NOW:%m/%d %H:%M}，當天 {len(todays)} 篇"}}]},
    }
    if date in TITLES:
        props["發文主題"] = {"rich_text": [{"text": {"content": f"Day {TITLES[date][0]} {TITLES[date][1]}"}}]}
    fmt = {"Instagram": "輪播", "Threads": "單圖"}[platform]
    if any(p["type"] == "Reel" for p in todays) and not any(p["type"] == "圖卡" for p in todays):
        fmt = "Reels"
    props["格式"] = {"select": {"name": fmt}}
    line = f"{platform} {date}：粉絲 {followers}、觀看 {agg['views']}、讚 {agg['likes']}、留言 {agg['comments']}、收藏 {agg['saves']}、分享 {agg['shares']}（{len(todays)} 篇）"
    if DRY:
        print(f"[試跑] 每日 {line}")
        return
    found = notion("POST", f"https://api.notion.com/v1/databases/{GROWTH_DB}/query",
                   {"filter": {"and": [{"property": "日期", "date": {"equals": date}}, {"property": "平台", "select": {"equals": platform}}]}, "page_size": 1}).get("results", [])
    if found:
        notion("PATCH", f"https://api.notion.com/v1/pages/{found[0]['id']}", {"properties": props})
    else:
        props["名稱"] = {"title": [{"text": {"content": f"{date[5:].replace('-', '/')} {short}"}}]}
        notion("POST", "https://api.notion.com/v1/pages", {"parent": {"database_id": GROWTH_DB}, "properties": props})
    print(("更新" if found else "新增") + " " + line)


def main() -> int:
    default_day = (NOW - timedelta(days=1)) if NOW.hour < 3 else NOW
    date = os.environ.get("TARGET_DATE") or default_day.strftime("%Y-%m-%d")
    if not DRY and not os.environ.get("NOTION_TOKEN"):
        print("::error::沒有 NOTION_TOKEN", file=sys.stderr)
        return 1
    failures = 0
    for platform, fn in (("Instagram", ig_collect), ("Threads", threads_collect)):
        try:
            res = fn()
            if res is None:
                print(f"{platform}：沒有權杖，略過")
                continue
            ok = 0
            for p in res["posts"]:
                try:
                    upsert_post(p)
                    ok += 1
                except RuntimeError as e:
                    print(f"::warning::{platform} 貼文 {p['id']} 寫入失敗：{e}", file=sys.stderr)
            print(f"{platform}：每篇貼文更新 {ok}/{len(res['posts'])} 篇（最近 {LOOKBACK} 天）")
            upsert_daily(date, platform, res["followers"], res["posts"])
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"::warning::{platform} 失敗：{e}", file=sys.stderr)
    return 1 if failures == 2 else 0


if __name__ == "__main__":
    sys.exit(main())
