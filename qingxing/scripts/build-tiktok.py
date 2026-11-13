"""把 IG 圖卡做成 TikTok 直式影片（1080×1920 MP4），一週一批。

用法：python3 qingxing/scripts/build-tiktok.py [開始日期 YYYY-MM-DD] [輸出資料夾]
  不給日期 → 從明天（台灣時間）開始的 7 天
輸出：每天一支 MP4、一個同名 .txt（TikTok 文案）、schedule.txt（本週排程清單），
以及 manifest.json（下載網址＋文案＋排程時間，給後台頁面和 Claude 自己讀）。
圖卡用 qingxing/ig/ 裡已產生的 JPG（1080×1350），上下補米白色變成 9:16，每張停 2.5–3.5 秒；動畫：慢推近、滑動換卡、底部進度條。
"""
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # qingxing/
BG = "0xF6F3EE"
FADE = 0.4
MIN_TOTAL = 15.0  # 每支至少 15 秒
WEEKDAY = "一二三四五六日"


def parse_post(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    meta, body = m.group(1), m.group(2).strip()
    images = re.findall(r"^\s*-\s+(\S+\.jpe?g)\s*$", meta, re.M)
    status = re.search(r"^status:\s*(\w+)", meta, re.M).group(1)
    return {"images": images, "status": status, "caption": body}


OTHER_PLATFORM = re.compile(r"IG|Instagram|Threads|@qingxing\.action|私訊")
# 2026-11-13：台灣 TikTok 個人帳號沒有可點的網站欄位（商業帳號要公司登記文件），
# 簡介只能放網址純文字 → 文案說「網址在主頁簡介」。滿 1,000 粉、有可點連結後改回 "主頁連結"。
LINK_PHRASE = "網址在主頁簡介"


def tiktok_caption(ig_caption: str, hook: str | None = None) -> str:
    """TikTok 文案。2026-11-13 Yang 定：TikTok 文案和影片內不放 IG 或其他平台導流、不放價格之外的硬銷；
    行動呼籲一律指「主頁連結」。hook＝開頭痛點句，取代原本第一行。"""
    lines = [l for l in ig_caption.splitlines() if not l.strip().startswith("#")]
    tags = re.findall(r"#[\w一-鿿]+", ig_caption)
    tags = [t for t in tags if t not in ("#清醒行動派", "#先清醒再行動", "#20歲")][:3]
    out = []
    for l in lines:
        if "留言「清醒」" in l:  # IG 的關鍵字私訊在 TikTok 沒有 → 改指主頁連結
            l = "免費的 7 天清醒行動表，在主頁連結。"
        elif OTHER_PLATFORM.search(l):
            continue
        out.append(l)
    if hook:
        first = next((i for i, l in enumerate(out) if l.strip()), None)
        if first is not None:
            out[first] = hook
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()
    text = re.sub(r"或點首頁 ?(Bio ?)?連結", "", text)
    text = text.replace("連結在首頁", "連結在主頁").replace("首頁 Bio 連結", "主頁連結")
    text = re.sub(r"在?主頁連結", LINK_PHRASE, text)
    assert not OTHER_PLATFORM.search(text), f"TikTok 文案還有其他平台：{text}"
    extra = [t for t in ("#自我成長", "#fyp") if t not in tags]
    return f"{text}\n\n#清醒行動派 {' '.join(tags + extra)}"


def reel_caption(ig_caption: str) -> str:
    """IG Reel 文案：去掉 hashtag 後的正文（含結尾問句）＋原本的 hashtag。"""
    lines = [l for l in ig_caption.splitlines() if not l.strip().startswith("#")]
    tags = re.findall(r"#[\w一-鿿]+", ig_caption)
    body = "\n".join(lines).strip()
    # 開頭加一句影片版引言，跟同日圖卡區隔（機器人用文案判斷有沒有發過）
    return "今天的重點，30 秒看完 👇\n\n" + body + "\n\n圖卡版在上一篇。\n\n" + " ".join(tags)


def write_reel_post(p: dict, post: dict, video_url: str) -> Path:
    """每支影片也排成 IG Reel（21:30，跟 20:00 的圖卡錯開），由 IG 機器人用 video: 發佈。"""
    path = ROOT / "instagram" / "posts" / f"{p['date']}-reel-day{p['day']:02d}.md"
    path.write_text(
        "---\n"
        f"# Day {p['day']} 的 TikTok 影片同步發 IG Reel；影片在 GitHub Releases，由 build-tiktok.py 產生\n"
        f"publish_at: {p['date']}T21:30:00+08:00\n"
        f"video: {video_url}\n"
        f"status: {post['status']}\n"
        "---\n" + reel_caption(post["caption"]) + "\n", encoding="utf-8")
    return path


ACCENT = "0x1F3A5F"
TRACK = "0xE4DED4"


def make_video(images: list[Path], out: Path, hook_first: bool = False) -> float:
    """2026-11-13 Yang：Reel 加動畫。每張慢慢推近 3.5%（開頭卡改成 0.8 秒從放大退回，像「打進來」），
    卡片之間往左滑（像滑輪播，開頭卡→第一張往上滑），底部留白區一條深藍進度條隨時間長滿。"""
    n = len(images)
    durs = [6.0] if n == 1 else [2.5] + [3.0] * (n - 2) + [3.5]
    # 太短的影片（單圖金句、字卡少）TikTok 不太推：整體拉到至少 MIN_TOTAL 秒，每張等比例放慢
    if sum(durs) < MIN_TOTAL:
        k = MIN_TOTAL / sum(durs)
        durs = [d * k for d in durs]
    total = sum(durs) + FADE - FADE * (n - 1) if n > 1 else durs[0]
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for img, d in zip(images, durs):
        args += ["-framerate", "30", "-loop", "1", "-t", f"{d + FADE:.2f}", "-i", str(img)]
    args += ["-f", "lavfi", "-t", "60", "-i", "anullsrc=r=44100:cl=stereo"]
    parts = []
    for i, d in enumerate(durs):
        frames = int((d + FADE) * 30)
        z = "1.10-0.10*min(on/24,1)" if (i == 0 and hook_first) else f"1+0.035*on/{frames}"
        parts.append(
            f"[{i}:v]scale=2160:2700,zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1350:fps=30,"
            f"pad=1080:1920:0:285:color={BG},setsar=1,format=yuv420p[v{i}]")
    last, offset = "v0", 0.0
    for i in range(1, n):
        offset += durs[i - 1]
        tr = "slideup" if (i == 1 and hook_first) else "slideleft"
        parts.append(f"[{last}][v{i}]xfade=transition={tr}:duration={FADE}:offset={offset - FADE * (i - 1):.2f}[x{i}]")
        last = f"x{i}"
    parts.append(f"color=c={TRACK}:s=840x6:r=30:d={total:.2f}[trk]")
    parts.append(f"color=c={ACCENT}:s=840x6:r=30:d={total:.2f}[bar]")
    parts.append(f"[trk][bar]overlay=x='-840+840*t/{total:.2f}':y=0[prog]")
    parts.append(f"[{last}][prog]overlay=x=120:y=1740:shortest=1[vout]")
    args += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", f"{n}:a",
             "-t", f"{total:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
             "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)]
    subprocess.run(args, check=True)
    return total


def make_motion(day: str, out: Path) -> float | None:
    """2026-11-13：預設用 build-motion.mjs 做全螢幕動態字卡（字逐字跳出、深藍開頭卡、分段進度條）。"""
    try:
        r = subprocess.run(["node", str(ROOT / "scripts" / "build-motion.mjs"), day, str(out)],
                           check=True, capture_output=True, text=True, timeout=600)
        return float(json.loads(r.stdout.strip().splitlines()[-1])["seconds"])
    except Exception as e:  # noqa: BLE001
        print(f"::warning::{day} 動態版失敗，改用圖卡版：{e}", file=sys.stderr)
        return None


def main() -> int:
    tz = timezone(timedelta(hours=8))
    start = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else datetime.now(tz).date() + timedelta(days=1)
    out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "tiktok-out").resolve()
    days = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else 7
    out_dir.mkdir(parents=True, exist_ok=True)
    schedule = json.loads((ROOT / "schedule.json").read_text(encoding="utf-8"))
    week = [p for p in schedule if start <= date.fromisoformat(p["date"]) < start + timedelta(days=days)]
    listing = [f"清醒行動派 TikTok 本週排程（{start:%m/%d} 起 {days} 天）",
               "在電腦用 Chrome 打開 TikTok Studio → 上傳 → 選影片 → 貼上同名 .txt 的文案 → 排程時間選當天 20:00。",
               "標「草稿」的那天先不要排，等 IG 那篇補好再做。", ""]
    repo = os.environ.get("GITHUB_REPOSITORY", "a0955072107-bit/life-dashboard")
    tag = f"tiktok-{start}"
    base = f"https://github.com/{repo}/releases/download/{tag}"
    manifest = {"start": start.isoformat(), "tag": tag,
                "release": f"https://github.com/{repo}/releases/tag/{tag}",
                "generatedAt": datetime.now(tz).isoformat(timespec="seconds"), "items": []}
    made = 0
    for p in week:
        d = date.fromisoformat(p["date"])
        post_file = next((ROOT / "instagram" / "posts").glob(f"{p['date']}-day*.md"), None)
        if not post_file:
            continue
        post = parse_post(post_file)
        name = f"{p['date']}-Day{p['day']:02d}"
        label = f"{d:%m/%d}（{WEEKDAY[d.weekday()]}）20:00　Day {p['day']}　{p['title']}"
        item = {"day": p["day"], "date": p["date"], "weekday": WEEKDAY[d.weekday()],
                "publish_at": f"{p['date']} 20:00", "title": p["title"], "status": post["status"]}
        manifest["items"].append(item)
        if post["status"] != "ready":
            listing.append(f"✏️ {label}　→ 草稿，先不要排")
            continue
        tt_file = ROOT / "tiktok" / "cards" / f"{p['date']}.json"
        tt = json.loads(tt_file.read_text(encoding="utf-8")) if tt_file.exists() else {}
        imgs = tt.get("images") or ([tt["hook"]["image"]] if tt.get("hook") else []) + post["images"]
        secs = make_motion(p["date"], out_dir / f"{name}.mp4")
        if secs is None:  # 動態版做不出來（沒有 node／Playwright）→ 退回圖卡版
            secs = make_video([ROOT.parent / img for img in imgs], out_dir / f"{name}.mp4",
                              hook_first=bool(tt.get("images") or tt.get("hook")))
        if tt.get("caption"):
            caption = tiktok_caption(tt["caption"] + "\n\n" + " ".join(re.findall(r"#[\w一-鿿]+", post["caption"])))
        else:
            caption = tiktok_caption(post["caption"], (tt.get("hook") or {}).get("text"))
        (out_dir / f"{name}.txt").write_text(caption + "\n", encoding="utf-8")
        item.update({"file": f"{name}.mp4", "video_url": f"{base}/{name}.mp4",
                     "caption_url": f"{base}/{name}.txt", "seconds": round(secs), "caption": caption})
        write_reel_post(p, post, item["video_url"])
        item["reel_post"] = f"instagram/posts/{p['date']}-reel-day{p['day']:02d}.md"
        listing.append(f"✅ {label}　→ {name}.mp4（{secs:.0f} 秒）＋ {name}.txt")
        made += 1
    if not week:
        listing.append("這 7 天沒有排程貼文，請 Claude 排下個月的內容。")
    # 檔名用英文：GitHub Releases 會把中文檔名改成 default.txt
    (out_dir / "schedule.txt").write_text("\n".join(listing) + "\n", encoding="utf-8")
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("\n".join(listing))
    print(f"完成 {made} 支影片 → {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
