"""把 IG 圖卡做成 TikTok 直式影片（1080×1920 MP4），一週一批。

用法：python3 qingxing/scripts/build-tiktok.py [開始日期 YYYY-MM-DD] [輸出資料夾]
  不給日期 → 從明天（台灣時間）開始的 7 天
輸出：每天一支 MP4、一個同名 .txt（TikTok 文案）、schedule.txt（本週排程清單），
以及 manifest.json（下載網址＋文案＋排程時間，給後台頁面和 Claude 自己讀）。
圖卡用 qingxing/ig/ 裡已產生的 JPG（1080×1350），上下補米白色變成 9:16，每張停 2.5–3.5 秒、淡入淡出。
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
WEEKDAY = "一二三四五六日"


def parse_post(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    meta, body = m.group(1), m.group(2).strip()
    images = re.findall(r"^\s*-\s+(\S+\.jpe?g)\s*$", meta, re.M)
    status = re.search(r"^status:\s*(\w+)", meta, re.M).group(1)
    return {"images": images, "status": status, "caption": body}


def tiktok_caption(ig_caption: str) -> str:
    # 正文保留；hashtag 換成 TikTok 常用的，結尾導到 IG／Bio
    lines = [l for l in ig_caption.splitlines() if not l.strip().startswith("#")]
    tags = re.findall(r"#[\w一-鿿]+", ig_caption)
    tags = [t for t in tags if t not in ("#清醒行動派", "#先清醒再行動")][:3]
    text = "\n".join(lines).strip().replace("留言「清醒」", "留言「清醒」或點主頁連結").replace("首頁 Bio", "主頁")
    return f"{text}\n\n完整圖文在 IG @qingxing.action\n\n#清醒行動派 {' '.join(tags)} #自我成長 #fyp"


def make_video(images: list[Path], out: Path) -> float:
    n = len(images)
    durs = [6.0] if n == 1 else [2.5] + [3.0] * (n - 2) + [3.5]
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for img, d in zip(images, durs):
        args += ["-loop", "1", "-t", f"{d + FADE:.2f}", "-i", str(img)]
    args += ["-f", "lavfi", "-t", "60", "-i", "anullsrc=r=44100:cl=stereo"]
    parts = [
        f"[{i}:v]scale=1080:1350,pad=1080:1920:0:285:color={BG},setsar=1,fps=30,format=yuv420p[v{i}]"
        for i in range(n)
    ]
    last, offset = "v0", 0.0
    for i in range(1, n):
        offset += durs[i - 1]
        parts.append(f"[{last}][v{i}]xfade=transition=fade:duration={FADE}:offset={offset - FADE * (i - 1):.2f}[x{i}]")
        last = f"x{i}"
    total = sum(durs) + FADE - FADE * (n - 1) if n > 1 else durs[0]
    args += ["-filter_complex", ";".join(parts), "-map", f"[{last}]", "-map", f"{n}:a",
             "-t", f"{total:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
             "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)]
    subprocess.run(args, check=True)
    return total


def main() -> int:
    tz = timezone(timedelta(hours=8))
    start = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else datetime.now(tz).date() + timedelta(days=1)
    out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "tiktok-out").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    schedule = json.loads((ROOT / "schedule.json").read_text(encoding="utf-8"))
    week = [p for p in schedule if start <= date.fromisoformat(p["date"]) < start + timedelta(days=7)]
    listing = [f"清醒行動派 TikTok 本週排程（{start:%m/%d} 起 7 天）",
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
        secs = make_video([ROOT.parent / img for img in post["images"]], out_dir / f"{name}.mp4")
        caption = tiktok_caption(post["caption"])
        (out_dir / f"{name}.txt").write_text(caption + "\n", encoding="utf-8")
        item.update({"file": f"{name}.mp4", "video_url": f"{base}/{name}.mp4",
                     "caption_url": f"{base}/{name}.txt", "seconds": round(secs), "caption": caption})
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
