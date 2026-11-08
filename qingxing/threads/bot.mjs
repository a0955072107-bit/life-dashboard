// 清醒行動派 Threads 機器人：由 GitHub Actions 每 30 分鐘執行一次，
// 把 qingxing/threads/posts.json 裡時間到了的純文字發到 Threads（一次最多一則，避免洗版）。
// posts.json 由 node qingxing/scripts/build-threads.mjs 從 IG 貼文拆出來。
//
// 環境變數：
//   THREADS_ACCESS_TOKEN  必填，Threads 權杖（GitHub Secrets：QX_THREADS_ACCESS_TOKEN）
//   DRY_RUN=true          只印出會做什麼，不真的發
//   MAX_LATE_HOURS        超過這麼久沒發的就不補發（預設 6 小時；一天四則，補太舊的沒意義）
import { readFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const TOKEN = process.env.THREADS_ACCESS_TOKEN
const DRY = process.env.DRY_RUN === 'true'
const API = process.env.THREADS_API_BASE || 'https://graph.threads.net/v1.0'
const MAX_LATE_HOURS = Number(process.env.MAX_LATE_HOURS || 6)
const now = new Date()
const summary = []
const log = (...a) => { const line = a.join(' '); console.log(line); summary.push(line) }
const warn = (msg) => console.log(`::warning::${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function th(method, path, params = {}) {
  const url = new URL(API + path)
  const init = { method }
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('access_token', TOKEN)
  } else {
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
    init.body = new URLSearchParams({ ...params, access_token: TOKEN })
  }
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    const e = body.error || {}
    throw new Error(`Threads API ${method} ${path} 失敗（${res.status}）：${e.message || JSON.stringify(body)}`)
  }
  return body
}

export const norm = (s = '') => s.replace(/\s+/g, ' ').trim().slice(0, 120)

export function duePosts(posts, now, maxLateHours) {
  const earliest = now.getTime() - maxLateHours * 3600_000
  return posts
    .filter((p) => p.status === 'ready' && p.text)
    .map((p) => ({ ...p, at: new Date(p.publish_at) }))
    .filter((p) => !Number.isNaN(p.at.getTime()) && p.at.getTime() <= now.getTime() && p.at.getTime() >= earliest)
    .sort((a, b) => a.at - b.at)
}

async function main() {
  if (!TOKEN) {
    log('::notice::還沒設定 THREADS_ACCESS_TOKEN，機器人先不動作。設定方法見 qingxing/threads/README.md')
    return
  }
  const me = await th('GET', '/me', { fields: 'id,username' })
  log(`Threads 帳號：@${me.username}${DRY ? '（試跑模式，不會真的發）' : ''}`)
  const posts = JSON.parse(readFileSync(join(here, 'posts.json'), 'utf8'))
  const due = duePosts(posts, now, MAX_LATE_HOURS)
  const upcoming = posts.filter((p) => p.status === 'ready' && new Date(p.publish_at) > now).length
  log(`Threads：共 ${posts.length} 則，排程中 ${upcoming} 則，現在該發 ${due.length} 則`)
  if (!due.length) return
  const recent = (await th('GET', '/me/threads', { fields: 'id,text,timestamp', limit: 50 })).data || []
  const seen = new Set(recent.map((t) => norm(t.text)))
  for (const p of due) {
    if (seen.has(norm(p.text))) continue
    if (DRY) { log(`[試跑] 會發 ${p.id}（${p.slot}）：${p.text.slice(0, 40).replace(/\n/g, ' ')}…`); return }
    try {
      const { id } = await th('POST', `/${me.id}/threads`, { media_type: 'TEXT', text: p.text })
      await sleep(3000) // 官方建議建立後等幾秒再發佈
      const pub = await th('POST', `/${me.id}/threads_publish`, { creation_id: id })
      log(`✅ 已發 Threads ${p.id}（${p.slot}）→ ${pub.id}`)
      return // 一次只發一則
    } catch (e) {
      warn(`${p.id} 發文失敗：${e.message}`)
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Threads 機器人\n\n${summary.map((l) => `- ${l}`).join('\n')}\n`)
      process.exit(1)
    }
  }
  log('該發的都已經在 Threads 上了，不重複發')
}

main().then(() => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Threads 機器人\n\n${summary.map((l) => `- ${l}`).join('\n')}\n`)
}).catch((e) => { console.log(`::error::${e.message}`); process.exit(1) })
