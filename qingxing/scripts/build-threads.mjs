// 把 IG 貼文（posts-data.mjs）拆成 Threads 純文字，每篇 4 則，寫到 qingxing/threads/posts.json。
// 用法：node qingxing/scripts/build-threads.mjs
// 每天四則（台灣時間）：08:30 開場一句、12:30 做法、18:00 金句、21:30 問句（導回 IG）。
// 草稿貼文（draft: true）拆出來的也是 draft，機器人不會發。重跑會整份覆蓋。
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POSTS } from './posts-data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(here, '..', 'threads')
const TIMES = ['08:30', '12:30', '18:00', '21:30']
const MAX = 480 // Threads 上限 500
// 文案結尾沒有問句的那幾篇，Threads 的問句手寫在這裡（key 是 Day）
const QUESTIONS = {
  1: '你的迷惘比較像哪一種：選項太多、用別人的時間表量自己、還是想一次選對？留言 1、2 或 3。',
  3: '你最近一次誠實回答「我在逃避什麼」是什麼時候？',
  6: '你上一次坐下來回顧自己這一週，是多久以前？',
  7: '你今天最焦慮的那件事，用一句話寫下來會是什麼？',
  11: '你起床後的第一個小時，通常在做什麼？',
  15: '你睡覺時手機放哪裡？留言：床頭、桌上，還是另一個房間。',
  10: '如果只能解決一件事，你最想先解決迷惘、拖延還是比較？留言 1、2 或 3。',
  13: '你今年初訂的目標，現在還記得幾個？',
  14: '你想養成的那個習慣，可以接在哪個已經做得很穩的習慣後面？',
  17: '你是哪一種？留言 1、2 或 3。',
  20: '你最近一次「知道該做卻沒做」的事是什麼？',
  21: '這週你只做三件事的話，會是哪三件？',
  22: '你有哪件事說好「明年再開始」的？留言跟我說。',
  23: '你那件一直拖的事，拆到最小是哪個動作？',
  24: '你拖最久的是哪一種事：工作、學習，還是跟人有關的？留言 1、2 或 3。',
  27: '你最近卡住的選擇是什麼？留言跟我說。',
  29: '你這一年做到了哪一件一年前覺得做不到的事？',
  30: '這 30 天裡，哪一篇對你最有用？留言那篇的 Day 幾。',
}

const isCta = (s) => /留言|首頁|Bio|NT\$|收藏|分享給|連結|私訊|《|第 ?\d+ ?章|組合|電子書|現在買|上架/.test(s)
const clean = (s) => s.replace(/｜/g, '\n').replace(/\n+/g, '\n').trim()
// 「標題｜內文」接成一句：標題有標點就直接接，短標題用「：」，其他用「，」
const oneLine = (s) => {
  const [a = '', ...rest] = s.split('｜').map((x) => x.trim())
  const b = rest.join('，')
  if (!b) return a.replace(/，$/, '')
  if (/[，。：；、！？]$/.test(a)) return a + b
  return [...a].length <= 4 ? `${a}：${b}` : `${a}，${b}`
}
const isIgOnly = (s) => /留言|私訊|首頁|連結|Bio|收藏起來|分享給/.test(s)
const paras = (caption) => caption.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !p.startsWith('#'))
const cut = (s) => ([...s].length > MAX ? [...s].slice(0, MAX - 1).join('') + '…' : s)

function split(post) {
  const slides = post.slides
  const ps = paras(post.caption)
  const body = slides.slice(1, -1).filter((s) => !isCta(s))
  const hookSlide = clean(slides[0])
  const firstPara = ps[0] || ''
  // 1. 開場：封面那句＋文案第一段（同一句就不重複）
  const hook = firstPara && !hookSlide.replace(/\n/g, '').includes(firstPara.slice(0, 8))
    ? `${hookSlide}\n\n${firstPara}` : hookSlide
  // 2. 做法：中間幾張字卡列成清單；單圖金句用文案第二段
  let how
  if (post.kind === 'quote') {
    how = ps[1] || ps[0] || hookSlide
  } else if (body.length >= 2) {
    how = `${oneLine(slides[0])}\n\n${body.map((s) => `・${oneLine(s)}`).join('\n')}`
  } else {
    how = ps[1] || ps[0] || hookSlide
  }
  // 3. 金句：行動呼籲前一張；跟開場太像就用文案倒數第二段
  const beforeCta = [...slides].reverse().find((s) => !isCta(s) && s !== slides[0])
  let quote = beforeCta ? oneLine(beforeCta) : ''
  if (post.kind === 'quote') quote = oneLine(slides[0])
  else if (!quote || hook.includes(quote.slice(0, 6))) quote = ps.length >= 3 ? ps[ps.length - 2] : oneLine(slides[0])
  // 4. 問句：找文案裡真正的問句（不是「留言清醒私訊你」那種 IG 專用的）＋導回 IG
  const asked = [...ps].reverse().find((x) => /[？?]/.test(x) && !/私訊|首頁|連結|Bio/.test(x))
  const q = QUESTIONS[post.day] || asked || `${oneLine(slides[0])}\n\n你最近有過這種時候嗎？留言跟我說。`
  const tail = /留言「清醒」/.test(post.caption)
    ? '想要免費的 7 天清醒行動表：到 IG @qingxing.action 留言「清醒」'
    : '完整圖文在 IG @qingxing.action'
  const question = `${q}\n\n${tail}`
  return [hook, how, quote, question].map(cut)
}

const items = []
for (const p of POSTS) {
  const texts = split(p)
  texts.forEach((text, i) => {
    items.push({
      id: `d${String(p.day).padStart(2, '0')}-${i + 1}`,
      day: p.day, date: p.date, slot: ['開場', '做法', '金句', '問句'][i],
      publish_at: `${p.date}T${TIMES[i]}:00+08:00`,
      status: p.draft ? 'draft' : 'ready',
      text,
    })
  })
}
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'posts.json'), JSON.stringify(items, null, 2) + '\n')
console.log(`Threads：${POSTS.length} 篇 → ${items.length} 則，寫到 qingxing/threads/posts.json`)
