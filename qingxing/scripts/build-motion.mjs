// 清醒行動派：動態字卡影片（1080×1920，30fps），給 TikTok 和 IG Reel 用。2026-11-13 Yang：影片要吸引人、不無趣。
// 跟靜態圖卡不同：直接用全螢幕 9:16 排版，字一個一個跳出來、重點句底下有深藍底線劃過、
// 開頭卡用深藍底白字（跟後面米白底形成反差，前 2 秒抓住眼睛）、上方有限時動態式的分段進度條、
// 背景有很淡的大號頁碼、最後一張有「收藏」書籤圖示跳動。
// 每一格用 Playwright 截圖（時間軸由 render(t) 決定，結果固定、不會掉格），直接丟給 ffmpeg。
//
// 用法：node qingxing/scripts/build-motion.mjs <日期 YYYY-MM-DD> <輸出 mp4>
// 內容來源：posts-data.mjs 該天的 hook＋slides（有 tiktok 專用版就用專用版）。
// TikTok 規則：畫面上不出現 IG、Threads、私訊、@帳號；提到領表／連結一律改成「網址在主頁簡介」。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { POSTS } from './posts-data.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const [date, out] = process.argv.slice(2)
const post = POSTS.find((p) => p.date === date)
if (!post || !out) {
  console.error('用法：node build-motion.mjs <YYYY-MM-DD> <out.mp4>（找不到這天的貼文）')
  process.exit(2)
}

export const LINK_PHRASE = '網址在主頁簡介' // 滿 1,000 粉、有可點連結後改回「主頁連結」（build-tiktok.py 同步改）
const CTA = `免費 7 天清醒行動表｜${LINK_PHRASE}`
const OTHER = /IG|Instagram|Threads|私訊|@qingxing|留言「清醒」|Bio/
const clean = (s) => (OTHER.test(s) ? CTA : s.replace(/在?主頁連結/g, LINK_PHRASE))

// ---------- 場景 ----------
const src = post.tiktok ? post.tiktok.slides : post.slides
const scenes = []
if (!post.tiktok && post.hook) scenes.push({ kind: 'hook', text: post.hook })
const norm = (s) => s.replace(/[｜\s，。]/g, '')
src.forEach((s, i) => {
  const prev = i > 0 ? src[i - 1].split('｜')[1] || '' : ''
  if (prev && norm(s) === norm(prev)) return // IG 封面的副標和下一張重複，影片裡只留一次
  scenes.push({ kind: i === 0 && !post.hook && !post.tiktok ? 'hook' : 'card', text: clean(s) })
})
if (post.tiktok) scenes[0].kind = 'hook'
// 單圖金句（quote）張數太少 → 補一張收藏卡，影片才有起伏
if (scenes.length < 3) scenes.push({ kind: 'card', text: '先存起來｜下次卡住時再看一次' })
scenes[scenes.length - 1].kind = scenes.length > 1 ? 'end' : scenes[scenes.length - 1].kind

const len = (s) => [...s.replace(/[｜\s]/g, '')].length
for (const s of scenes) {
  s.dur = s.kind === 'hook' ? 2.4 : s.kind === 'end' ? 3.2 : Math.min(4.2, Math.max(2.6, 1.4 + len(s.text) * 0.075))
}
const MIN_TOTAL = 15
const sum = scenes.reduce((a, s) => a + s.dur, 0)
if (sum < MIN_TOTAL) scenes.forEach((s) => (s.dur *= MIN_TOTAL / sum))
let acc = 0
for (const s of scenes) { s.start = acc; acc += s.dur }
const TOTAL = acc
const FPS = 30

// ---------- 頁面 ----------
const C = { bg: '#F6F3EE', ink: '#2B2B2B', muted: '#5F5B55', accent: '#1F3A5F', track: '#E4DED4' }
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1920px;overflow:hidden;font-family:'Noto Sans CJK TC','Noto Sans TC',sans-serif;background:${C.bg};color:${C.ink}}
#bg{position:absolute;inset:0;background:${C.accent};transform-origin:50% 0}
#bar{position:absolute;left:72px;right:72px;top:96px;display:flex;gap:10px;z-index:5}
#bar i{flex:1;height:8px;border-radius:4px;background:${C.track};overflow:hidden;position:relative}
#bar b{position:absolute;inset:0;width:0;background:${C.accent}}
.brand{position:absolute;left:80px;top:150px;font-size:30px;letter-spacing:.3em;font-weight:700;z-index:5}
.scene{position:absolute;left:80px;right:180px;top:300px;height:1150px;display:flex;flex-direction:column;justify-content:center;opacity:0}
.ghost{position:absolute;right:-40px;top:880px;font-size:420px;font-weight:900;line-height:1;color:${C.accent};opacity:.06;letter-spacing:-.04em}
.t{font-weight:900;line-height:1.3}
.t span{display:inline-block;will-change:transform}
.ul{height:14px;background:${C.accent};border-radius:7px;margin-top:28px;width:0}
.p{margin-top:48px;font-size:58px;line-height:1.55;color:${C.muted};font-weight:500}
.p div{opacity:0}
.hook .t{color:#fff}
.hook .ul{background:#fff}
.end .t{color:${C.accent}}
.mark{width:120px;height:150px;margin-top:60px}
</style>
<div id="bg"></div><div id="bar"></div><div class="brand" id="brand">清醒行動派</div><div id="stage"></div>
<script>
const SC = ${JSON.stringify(scenes)}, TOTAL = ${TOTAL};
const lines = (s) => s.split(/(?<=[，。？！、])/).map((x) => x.trim()).filter(Boolean)
const W = 820
const fit = (ls, max) => Math.max(64, Math.min(max, Math.floor(W / (Math.max(...ls.map((l) => [...l].length)) + 0.3))))
const bar = document.getElementById('bar'), stage = document.getElementById('stage')
SC.forEach(() => { const i = document.createElement('i'); i.appendChild(document.createElement('b')); bar.appendChild(i) })
let n = 0
SC.forEach((s, k) => {
  let [h, p] = s.text.includes('｜') ? s.text.split('｜') : [s.text, '']
  if (/，$/.test(h) && p && s.kind !== 'card') { h = h + p; p = '' }
  const tl = lines(h), size = fit(tl, s.kind === 'hook' ? 132 : 116)
  const el = document.createElement('div'); el.className = 'scene ' + s.kind
  let html = ''
  if (s.kind === 'card') { n++; html += '<div class="ghost">' + String(n).padStart(2, '0') + '</div>' }
  html += '<div class="t" style="font-size:' + size + 'px">' + tl.map((l) => [...l].map((c) => '<span>' + (c === ' ' ? '&nbsp;' : c) + '</span>').join('')).join('<br>') + '</div><div class="ul"></div>'
  if (p) html += '<div class="p">' + lines(p).map((l) => '<div>' + l + '</div>').join('') + '</div>'
  if (s.kind === 'end') html += '<svg class="mark" viewBox="0 0 24 30"><path d="M3 2h18v26l-9-6-9 6z" fill="${C.accent}"/></svg>'
  el.innerHTML = html; stage.appendChild(el); s.el = el
})
const clamp = (x) => Math.max(0, Math.min(1, x))
const outC = (x) => 1 - Math.pow(1 - clamp(x), 3)
const back = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }
window.render = (t) => {
  const bgEl = document.getElementById('bg'), brand = document.getElementById('brand')
  SC.forEach((s, k) => {
    const b = bar.children[k].firstChild
    b.style.width = (clamp((t - s.start) / s.dur) * 100) + '%'
    const lt = t - s.start, el = s.el
    if (lt < 0 || lt > s.dur) { el.style.opacity = 0; return }
    // 進場：整塊往上浮；出場：最後 0.3 秒往上滑走
    const outEnd = s.kind === 'hook' ? s.dur - 0.12 : s.dur
    const outP = clamp((lt - (outEnd - 0.3)) / 0.3)
    el.style.opacity = 1 - outP
    el.style.transform = 'translateY(' + (-120 * outC(outP)) + 'px)'
    // 字一個一個跳出來（開頭卡更快、帶彈性）
    const spans = el.querySelectorAll('.t span'), step = s.kind === 'hook' ? 0.035 : 0.03
    const delay = k > 0 && SC[k - 1].kind === 'hook' ? 0.25 : 0.1
    spans.forEach((sp, i) => {
      const p = (lt - delay - i * step) / 0.35
      const y = 70 * (1 - (s.kind === 'hook' ? back(p) : outC(p)))
      sp.style.opacity = clamp(p * 1.6)
      sp.style.transform = 'translateY(' + y + 'px)'
    })
    const textDone = delay + spans.length * step + 0.25
    el.querySelector('.ul').style.width = (outC((lt - textDone) / 0.45) * 260) + 'px'
    el.querySelectorAll('.p div').forEach((d, i) => {
      const p = outC((lt - textDone - 0.1 - i * 0.22) / 0.4)
      d.style.opacity = p; d.style.transform = 'translateX(' + (-40 * (1 - p)) + 'px)'
    })
    const g = el.querySelector('.ghost')
    if (g) g.style.transform = 'translateY(' + (60 - 120 * clamp(lt / s.dur)) + 'px)'
    const m = el.querySelector('.mark')
    if (m) { const q = lt - textDone - 0.3; m.style.transform = 'translateY(' + (q > 0 ? -Math.abs(Math.sin(q * 5)) * 30 * Math.exp(-q * 1.2) : 0) + 'px)'; m.style.opacity = clamp(q * 3) }
  })
  // 開頭卡：深藍底，結束時往上收起露出米白底
  const hook = SC[0].kind === 'hook' ? SC[0] : null
  const hp = hook ? clamp((t - (hook.dur - 0.18)) / 0.38) : 1
  bgEl.style.transform = 'scaleY(' + (1 - outC(hp)) + ')'
  brand.style.color = hp < 0.5 && hook ? '#fff' : '${C.ink}'
}
</script>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-f', 'lavfi', '-t', String(TOTAL), '-i', 'anullsrc=r=44100:cl=stereo',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
const frames = Math.round(TOTAL * FPS)
for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => window.render(t), f / FPS)
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 })
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
}
ff.stdin.end()
await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg ' + c)))))
await browser.close()
console.log(JSON.stringify({ file: out, seconds: Math.round(TOTAL), scenes: scenes.map((s) => s.text) }))
