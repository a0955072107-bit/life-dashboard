// 《從迷惘到行動》手機精簡版：1080×1350 直式 PDF，每章 3 頁（一句重點、三個做法、今天做一件事）。
// 內容對照 Canva 簡報版電子書；每兩週加新章節時，在 CHAPTERS 最後加一章再重跑。
// 用法：node qingxing/ebook-mobile/build.mjs [輸出資料夾]   → 產生「從迷惘到行動_手機精簡版_V{n}.pdf」
// PDF 是付費內容，不要提交到這個公開 repo（.gitignore 已排除）。
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

export const VERSION = 'V1'
export const CHAPTERS = [
  { no: 0, name: '先清醒，再行動', key: '迷惘不是能力問題，是沒有人教你怎麼選。', listTitle: '迷惘的三個來源',
    items: ['選項太多，沒有篩選標準', '用別人的時間表量自己', '想一次選對，所以不敢選'],
    today: '寫下三行：我現在的狀態、我最想改變的一件事、我願意每天花幾分鐘。' },
  { no: 1, name: '清醒：你在逃避什麼', key: '迷惘多半是逃避的偽裝。', listTitle: '三種逃避型態',
    items: ['拖延型：事情放著不動，時間到了才焦慮', '假準備型：一直蒐集資訊，從沒開始', '忙碌轉移型：用別的事填滿時間，重要的事一直等'],
    today: '列出 3 件一直沒做的事，每件標一個原因：怕失敗、怕麻煩、不知道怎麼開始、其實不想要。' },
  { no: 2, name: '比較：把別人的時間表還給別人', key: '你比較的是他的結果，不是他的過程。', listTitle: '三問法',
    items: ['他的起點和我一樣嗎？', '我願意過他的每一天嗎？', '我在看的，是我真正想要的嗎？'],
    today: '下次羨慕別人時，三題各寫一句答案，再寫一個今天能做的小動作。' },
  { no: 3, name: '選擇：先刪，再選', key: '選不出來，不是因為都好，是因為沒有刪。', listTitle: '刪除法',
    items: ['第一刪：現在做不到的（時間、金錢、能力）', '第二刪：只是別人覺得好的', '第三刪：選了會放不下其他的'],
    today: '寫下卡住的選擇，列出所有選項，刪到剩 3 個以下，挑一個試做兩週。' },
  { no: 4, name: '拆解：把任務拆到不能再拆', key: '你不是懶，是任務太大。', listTitle: '四層拆解',
    items: ['目標：這一季最想完成的一件事', '里程碑：每個月一個可檢查的成果', '本週任務：這週要做的 1–3 件事', '今天的下一步：5 分鐘內能開始的動作'],
    today: '挑一件拖最久的事，一直拆，拆到 5 分鐘能做完，然後現在就做。' },
  { no: 5, name: '90 天：一季一個目標', key: '一年太長，90 天剛好。', listTitle: '90 天怎麼排',
    items: ['一季只選一個主目標', '拆成 3 個月的里程碑', '每週一個「週日晚上能打勾」的結果'],
    today: '用一句話寫下接下來 90 天唯一的主目標，和第一個月要做到的結果。' },
  { no: 6, name: '檢討：每週 15 分鐘不重來', key: '檢討做法，不檢討自己。', listTitle: '三題法',
    items: ['這週做到了什麼？', '哪裡卡住了？為什麼？', '下週只調整哪一件事？'],
    today: '在手機行事曆設一個每週日晚上 15 分鐘的提醒，名稱就叫「週檢討」。' },
]

const C = { bg: '#F6F3EE', ink: '#2B2B2B', muted: '#5F5B55', accent: '#1F3A5F', line: '#E3DDD3' }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const css = `@page{size:1080px 1350px;margin:0}*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans CJK TC','Noto Sans TC',sans-serif;color:${C.ink}}
.pg{width:1080px;height:1350px;background:${C.bg};position:relative;overflow:hidden;page-break-after:always}
.brand{position:absolute;left:96px;top:96px;font-size:28px;letter-spacing:.2em;font-weight:700}
.box{position:absolute;left:96px;right:96px;top:190px;bottom:210px;display:flex;flex-direction:column;justify-content:center}
.rule{width:120px;height:8px;background:${C.accent};border-radius:4px}
.ch{font-size:36px;color:${C.accent};font-weight:700;letter-spacing:.1em;margin:40px 0 8px}
h1{font-size:76px;line-height:1.3;font-weight:900;margin:12px 0 40px}
.key{font-size:56px;line-height:1.5;font-weight:700;margin:0}
.lt{font-size:64px;font-weight:900;margin:12px 0 44px}
ol{list-style:none;padding:0;margin:0}li{display:flex;gap:28px;align-items:flex-start;font-size:46px;line-height:1.5;padding:26px 0;border-bottom:3px solid ${C.line}}
li b{flex:none;width:72px;height:72px;border-radius:99px;background:${C.accent};color:#fff;display:flex;align-items:center;justify-content:center;font-size:36px;margin-top:2px}
.now{display:inline-block;background:${C.accent};color:#fff;font-size:36px;font-weight:700;letter-spacing:.15em;padding:12px 32px;border-radius:99px;margin-bottom:44px}
.todo{font-size:54px;line-height:1.6;font-weight:700;margin:0}
.p{font-size:46px;line-height:1.6;color:${C.muted};margin:0}
.foot{position:absolute;left:96px;right:96px;bottom:80px;display:flex;justify-content:space-between;font-size:28px;color:${C.muted}}`

function pages() {
  const out = []
  out.push({ body: `<div class="rule"></div><div class="ch">手機精簡版 ${VERSION}</div><h1 style="font-size:104px">從迷惘到行動</h1><p class="p">每章 3 頁，5 分鐘看懂一章。<br>完整工作頁請看簡報版。</p>` })
  out.push({ body: `<div class="lt">怎麼用這份精簡版</div><ol>${['一天看一章，不要一次看完', '看完就做「今天做一件事」那一頁', '想動手寫，打開簡報版的工作頁'].map((x, i) => `<li><b>${i + 1}</b><span>${esc(x)}</span></li>`).join('')}</ol>` })
  for (const c of CHAPTERS) {
    out.push({ body: `<div class="rule"></div><div class="ch">第 ${c.no} 章</div><h1>${esc(c.name)}</h1><p class="key">${esc(c.key)}</p>` })
    out.push({ body: `<div class="ch" style="margin-top:0">第 ${c.no} 章</div><div class="lt">${esc(c.listTitle)}</div><ol>${c.items.map((x, i) => `<li><b>${i + 1}</b><span>${esc(x)}</span></li>`).join('')}</ol>` })
    out.push({ body: `<div class="ch" style="margin-top:0">第 ${c.no} 章</div><div><span class="now">今天做一件事</span></div><p class="todo">${esc(c.today)}</p>` })
  }
  out.push({ body: `<div class="rule"></div><h1 style="margin-top:44px">先清醒，再行動</h1><p class="p">做完這 ${CHAPTERS.length} 章，你手上已經有自己的 90 天方向。接下來只要每週 15 分鐘。<br><br>完整工作頁在簡報版<br>IG @qingxing.action</p>` })
  return out.map((p, i, all) => `<section class="pg"><div class="brand">清醒行動派｜手機精簡版</div><div class="box">${p.body}</div><div class="foot"><span>從迷惘到行動</span><span>${i + 1} / ${all.length}</span></div></section>`).join('')
}

const outDir = resolve(process.argv[2] || '.')
mkdirSync(outDir, { recursive: true })
const file = join(outDir, `從迷惘到行動_手機精簡版_${VERSION}.pdf`)
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>${pages()}`)
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: file, width: '1080px', height: '1350px', printBackground: true })
await browser.close()
console.log(file)
