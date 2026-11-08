"""清醒行動派：每晚自動抓 IG 與 Threads 的數據，寫進 Notion「成長數據」（一天一平台一筆）。

環境變數：
  IG_ACCESS_TOKEN       IG 權杖（EAA… 系統用戶權杖走 graph.facebook.com；IGAA… 走 graph.instagram.com）
  IG_USER_ID            IG 帳號 ID（EAA 權杖必填）
  THREADS_ACCESS_TOKEN  Threads 權杖（TH…），要有 threads_basic、threads_manage_insights
  NOTION_TOKEN          Notion integration token
  TARGET_DATE           要記錄的日期（台北，YYYY-MM-DD），預設今天
  DRY_RUN=true          只印出數字，不寫 Notion
寫法：粉絲數＝現在的累計追蹤數；觀看／讚／留言／收藏／分享＝「那一天發的貼文」目前累計的互動（隔天再跑會更新成更滿的數字）。
Threads 的「收藏」沒有對應欄位，用 reposts＋quotes 填進「分享」。
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

TPE = timezone(timedelta(hours=8))
GROWTH_DB = "c6c1c75e84454b7f9e4fe7fa73fcdd5e"
NOTION = {"Authorization": f"Bearer {os.environ.get('NOTION_TOKEN','')}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
DRY = os.environ.get("DRY_RUN") == "true"
ROOT = Path(__file__).resolve().parent.parent
SCHEDULE = ROOT / "qingxing" / "schedule.json"


def day_title(date: str) -> str:
    try:
        for p in json.loads(SCHEDULE.read_text(encoding="utf-8")):
            if p["date"] == date:
                return f"Day {p['day']} {p['title']}"
    except Exception:  # noqa: BLE001
        pass
    return ""


def get(url, **params):
    r = requests.get(url, params=params, timeout=30)
    j = r.json()
    if r.status_code >= 300 or "error" in j:
        raise RuntimeError(f"{url.split('/v')[0]} {r.status_code}: {j.get('error', j)}")
    return j


# ---------- IG ----------
def ig_stats(date: str):
    tok = os.environ.get("IG_ACCESS_TOKEN", "")
    if not tok:
        return None
    if tok.startswith("EAA"):
        base = "https://graph.facebook.com/v21.0"
        uid = os.environ.get("IG_USER_ID", "")
        if not uid:
            raise RuntimeError("EAA 權杖需要 IG_USER_ID")
    else:
        base = "https://graph.instagram.com/v21.0"
        uid = get(f"{base}/me", fields="user_id,id", access_token=tok).get("user_id") or "me"
    prof = get(f"{base}/{uid}", fields="followers_count,media_count,username", access_token=tok)
    media = get(f"{base}/{uid}/media", fields="id,timestamp,media_type,media_product_type,like_count,comments_count,caption", limit=20, access_token=tok).get("data", [])
    todays = [m for m in media if datetime.fromisoformat(m["timestamp"].replace("Z", "+00:00")).astimezone(TPE).strftime("%Y-%m-%d") == date]
    agg = {"views": 0, "likes": 0, "comments": 0, "saves": 0, "shares": 0}
    fmt, topics = None, []
    for m in todays:
        agg["likes"] += m.get("like_count") or 0
        agg["comments"] += m.get("comments_count") or 0
        reel = m.get("media_product_type") == "REELS" or m.get("media_type") == "VIDEO"
        fmt = fmt or ("Reels" if reel else "輪播" if m.get("media_type") == "CAROUSEL_ALBUM" else "單圖")
        for metrics in (("views", "reach", "saved", "shares"), ("reach", "saved", "shares"), ("saved",)):
            try:
                ins = get(f"{base}/{m['id']}/insights", metric=",".join(metrics), access_token=tok).get("data", [])
                vals = {x["name"]: (x.get("values") or [{}])[0].get("value", 0) or 0 for x in ins}
                agg["views"] += vals.get("views") or vals.get("reach") or 0
                agg["saves"] += vals.get("saved", 0)
                agg["shares"] += vals.get("shares", 0)
                break
            except RuntimeError:
                continue
    return {"platform": "Instagram", "followers": prof.get("followers_count", 0), "posts": len(todays), "format": fmt, **agg,
            "username": prof.get("username")}


# ---------- Threads ----------
def threads_stats(date: str):
    tok = os.environ.get("THREADS_ACCESS_TOKEN", "")
    if not tok:
        return None
    base = "https://graph.threads.net/v1.0"
    me = get(f"{base}/me", fields="id,username", access_token=tok)
    followers = 0
    try:
        fi = get(f"{base}/me/threads_insights", metric="followers_count", access_token=tok).get("data", [])
        for x in fi:
            followers = x.get("total_value", {}).get("value") or (x.get("values") or [{}])[-1].get("value", 0) or 0
    except RuntimeError as e:
        print(f"::warning::Threads 粉絲數讀不到（{e}），填 0", file=sys.stderr)
    posts = get(f"{base}/me/threads", fields="id,timestamp,text", limit=30, access_token=tok).get("data", [])
    todays = [p for p in posts if datetime.fromisoformat(p["timestamp"].replace("Z", "+00:00").replace("+0000", "+00:00")).astimezone(TPE).strftime("%Y-%m-%d") == date]
    agg = {"views": 0, "likes": 0, "comments": 0, "saves": 0, "shares": 0}
    for p in todays:
        try:
            ins = get(f"{base}/{p['id']}/insights", metric="views,likes,replies,reposts,quotes", access_token=tok).get("data", [])
            vals = {x["name"]: (x.get("values") or [{}])[0].get("value", 0) or 0 for x in ins}
            agg["views"] += vals.get("views", 0); agg["likes"] += vals.get("likes", 0)
            agg["comments"] += vals.get("replies", 0); agg["shares"] += vals.get("reposts", 0) + vals.get("quotes", 0)
        except RuntimeError as e:
            print(f"::warning::Threads 貼文 {p['id']} insights 讀不到：{e}", file=sys.stderr)
    return {"platform": "Threads", "followers": followers, "posts": len(todays), "format": None, **agg, "username": me.get("username")}


# ---------- Notion ----------
def find_row(date: str, platform: str):
    body = {"filter": {"and": [{"property": "日期", "date": {"equals": date}}, {"property": "平台", "select": {"equals": platform}}]}, "page_size": 1}
    r = requests.post(f"https://api.notion.com/v1/databases/{GROWTH_DB}/query", headers=NOTION, json=body, timeout=30)
    r.raise_for_status()
    res = r.json().get("results", [])
    return res[0]["id"] if res else None


def upsert(date: str, s: dict):
    short = {"Instagram": "IG", "Threads": "Threads"}[s["platform"]]
    props = {
        "日期": {"date": {"start": date}},
        "平台": {"select": {"name": s["platform"]}},
        "粉絲數": {"number": s["followers"]},
        "觀看數": {"number": s["views"]}, "按讚": {"number": s["likes"]}, "留言": {"number": s["comments"]},
        "收藏": {"number": s["saves"]}, "分享": {"number": s["shares"]},
        "備註": {"rich_text": [{"text": {"content": f"自動抓取 {datetime.now(TPE):%m/%d %H:%M}，當天 {s['posts']} 篇"}}]},
    }
    title = day_title(date)
    if title:
        props["發文主題"] = {"rich_text": [{"text": {"content": title}}]}
    if s.get("format"):
        props["格式"] = {"select": {"name": s["format"]}}
    if DRY:
        print(f"[試跑] {s['platform']} {date}: {json.dumps({k: s[k] for k in ('followers','posts','views','likes','comments','saves','shares')}, ensure_ascii=False)}")
        return
    pid = find_row(date, s["platform"])
    if pid:
        r = requests.patch(f"https://api.notion.com/v1/pages/{pid}", headers=NOTION, json={"properties": props}, timeout=30)
    else:
        props["名稱"] = {"title": [{"text": {"content": f"{date[5:].replace('-', '/')} {short}"}}]}
        r = requests.post("https://api.notion.com/v1/pages", headers=NOTION, json={"parent": {"database_id": GROWTH_DB}, "properties": props}, timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"Notion {r.status_code}: {r.text[:300]}")
    print(f"{'更新' if pid else '新增'} {s['platform']} {date}：粉絲 {s['followers']}、觀看 {s['views']}、讚 {s['likes']}、留言 {s['comments']}、收藏 {s['saves']}、分享 {s['shares']}（{s['posts']} 篇）")


def main() -> int:
    date = os.environ.get("TARGET_DATE") or datetime.now(TPE).strftime("%Y-%m-%d")
    if not DRY and not os.environ.get("NOTION_TOKEN"):
        print("::error::沒有 NOTION_TOKEN", file=sys.stderr); return 1
    failures = 0
    for fn in (ig_stats, threads_stats):
        try:
            s = fn(date)
            if s is None:
                print(f"{fn.__name__}：沒有權杖，略過"); continue
            upsert(date, s)
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"::warning::{fn.__name__} 失敗：{e}", file=sys.stderr)
    return 1 if failures == 2 else 0


if __name__ == "__main__":
    sys.exit(main())
