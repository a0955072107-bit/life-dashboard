// 產生「清醒行動派」IG 貼文圖片（1080×1350 直式 JPEG）到 qingxing/ig/，
// 並把每篇貼文的設定與文案寫到 qingxing/instagram/posts/。內容在 posts-data.mjs。
// 用法：node qingxing/scripts/build-ig.mjs          → 產生全部
//       node qingxing/scripts/build-ig.mjs 7        → 只產生第 7 天
// 注意：重跑會覆蓋貼文檔；要改文案請改 posts-data.mjs 再重跑。
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { POSTS, FIXED_TAGS } from './posts-data.mjs'

const { chromium } = createRequire(import.meta.url)('playwright') // 用電腦上已安裝的 Playwright
const here = dirname(fileURLToPath(import.meta.url))
const IG_DIR = join(here, '..', 'ig')
const POST_DIR = join(here, '..', 'instagram', 'posts')
mkdirSync(IG_DIR, { recursive: true })
mkdirSync(POST_DIR, { recursive: true })

const C = { bg: '#F6F3EE', ink: '#2B2B2B', muted: '#5F5B55', accent: '#1F3A5F', line: '#E3DDD3' }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
// 【】裡的字用強調色
const mark = (s) => esc(s).replace(/(【[^】]*】)/g, `<span style="color:${C.accent}">$1</span>`)
const split = (s) => {
  const i = s.indexOf('｜')
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
}

const base = `*{box-sizing:border-box}body{margin:0;width:1080px;height:1350px;background:${C.bg};color:${C.ink};
  font-family:'Noto Sans CJK TC','Noto Sans TC',sans-serif;overflow:hidden;position:relative}
  .brand{position:absolute;left:96px;top:96px;font-size:28px;letter-spacing:.3em;font-weight:700}
  .box{position:absolute;left:96px;right:96px;top:180px;bottom:200px;display:flex;flex-direction:column;justify-content:center}
  .rule{width:120px;height:8px;background:${C.accent};border-radius:4px;flex:none}
  .t{font-weight:900;line-height:1.35;margin:44px 0 36px}
  .p{font-size:50px;line-height:1.6;color:${C.muted};margin:0;font-weight:500}
  .foot{position:absolute;left:96px;right:96px;bottom:72px;display:flex;justify-content:space-between;font-size:28px;color:${C.muted};letter-spacing:.05em}
  .ph{border:4px dashed ${C.accent};border-radius:24px;padding:48px}
  .slogan{position:absolute;left:96px;bottom:150px;font-size:40px;letter-spacing:.2em;color:${C.muted}}`
const foot = (n, t) => `<div class="foot"><span>@qingxing.action</span><span>${t > 1 ? `${n} / ${t}${n < t ? '　→' : ''}` : ''}</span></div>`
const WIDTH = 888
// 按逗號、句號分行，字級依最長那行自動縮小，避免一個字掉到下一行
function lines(...parts) {
  return parts.filter(Boolean).join('').split(/(?<=[，。？！])/).map((x) => x.trim()).filter(Boolean)
}
function fit(ls, max, min = 60) {
  const longest = Math.max(...ls.map((l) => [...l].length))
  return Math.max(min, Math.min(max, Math.floor(WIDTH / (longest + 0.3))))
}
const title = (ls, max, color) => `<div class="t" style="font-size:${fit(ls, max)}px${color ? `;color:${color}` : ''}">${ls.map(mark).join('<br>')}</div>`

function slideHtml(text, n, t, kind) {
  let [h, p] = split(text)
  // 標題以逗號結尾（例：方向不是想出來的，｜是做出來的）→ 後半句也是標題，一起放大
  if (/，$/.test(h) && p) { h = h + p; p = '' }
  const isFirst = n === 1
  const isLast = n === t && t > 1
  if (kind === 'quote') {
    return `<style>${base}</style><div class="brand">清醒行動派</div>
      <div class="box"><div class="rule"></div>${title(lines(h, p), 100)}</div>${foot(n, t)}`
  }
  if (isLast) {
    return `<style>${base}.p{color:${C.ink};font-weight:700}</style><div class="brand">清醒行動派</div>
      <div class="box">${title(lines(h), 92, C.accent)}${p ? `<p class="p">${mark(p)}</p>` : ''}</div>
      <div class="slogan">先清醒，再行動</div>${foot(n, t)}`
  }
  const placeholder = /^【/.test(h)
  return `<style>${base}</style><div class="brand">清醒行動派</div>
    <div class="box"><div${placeholder ? ' class="ph"' : ''}><div class="rule"></div>${title(lines(h), isFirst ? 108 : 88)}${p ? `<p class="p">${mark(p)}</p>` : ''}</div></div>${foot(n, t)}`
}

const only = process.argv[2] ? Number(process.argv[2]) : null
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })
let made = 0
for (const post of POSTS) {
  if (only && post.day !== only) continue
  const name = `${post.date}-day${String(post.day).padStart(2, '0')}-${post.slug}`
  const total = post.slides.length
  const images = []
  for (let i = 0; i < total; i++) {
    const file = total > 1 ? `${name}-${i + 1}.jpg` : `${name}.jpg`
    await page.setContent(`<!doctype html><meta charset="utf-8">${slideHtml(post.slides[i], i + 1, total, post.kind)}`)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(IG_DIR, file), type: 'jpeg', quality: 90 })
    images.push(`qingxing/ig/${file}`)
  }
  const note = post.kind === 'reel' ? '# 短影音日：自動發字幕卡輪播；你也可以另外錄口播 Reels／抖音\n' : ''
  const md = `---\n${note}publish_at: ${post.date}T20:00:00+08:00\nimages:\n${images.map((x) => `  - ${x}`).join('\n')}\nstatus: ${post.draft ? 'draft' : 'ready'}\n---\n${post.caption}\n\n${FIXED_TAGS} ${post.tags}\n`
  writeFileSync(join(POST_DIR, `${name}.md`), md)
  made++
  console.log(`Day ${post.day}：${total} 張圖${post.draft ? '（草稿）' : ''}`)
}
await browser.close()

// 給後台儀表板看的排程清單（qingxing/schedule.json）：每篇的日期、標題、格式、狀態、封面
const schedule = POSTS.map((p) => {
  const name = `${p.date}-day${String(p.day).padStart(2, '0')}-${p.slug}`
  return {
    day: p.day, date: p.date, kind: p.kind, status: p.draft ? 'draft' : 'ready',
    title: p.slides[0].replace('｜', ' '),
    cover: `ig/${p.slides.length > 1 ? `${name}-1` : name}.jpg`,
    note: p.draft ? '草稿：要補內容才會自動發' : '',
  }
})
writeFileSync(join(here, '..', 'schedule.json'), JSON.stringify(schedule, null, 1) + '\n')
console.log(`完成 ${made} 篇，排程清單 ${schedule.length} 篇`)
