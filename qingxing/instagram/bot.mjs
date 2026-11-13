// 清醒行動派 IG 機器人（沿用店語文案的機器人）：由 GitHub Actions 每 30 分鐘執行一次。
// 1. 發文：instagram/posts/ 裡時間到了的貼文 → 發到 IG
// 2. 回留言：最近貼文的新留言，對到 replies.json 的關鍵字就回覆（可順便私訊）
// 3. 回私訊：24 小時內的新私訊，對到關鍵字就回；第一次來訊回歡迎訊息
//
// 環境變數：
//   IG_ACCESS_TOKEN  必填，IG 權杖（放在 GitHub Secrets）
//   DRY_RUN=true     只印出會做什麼，不真的發文或回覆
//   BOT_TASKS        要做哪些事，預設 post,comments,dms
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadPosts, validatePost, duePosts, alreadyPosted, imageUrl, planCommentReply, planDmReply,
} from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(here, 'replies.json'), 'utf8'))
const TOKEN = process.env.IG_ACCESS_TOKEN
const DRY = process.env.DRY_RUN === 'true'
const TASKS = (process.env.BOT_TASKS || 'post,comments,dms').split(',').map((s) => s.trim())
// 兩種權杖：舊版 IGAA…（Instagram 登入）走 graph.instagram.com；新版統一登入的系統用戶權杖 EAA…（永不到期）走 graph.facebook.com，
// 而且要知道 IG 帳號 ID（IG_USER_ID，Meta 開發者頁「產生存取權杖」區帳號名下那串數字）。
const IS_FB_TOKEN = (process.env.IG_ACCESS_TOKEN || '').startsWith('EAA')
const API = process.env.IG_API_BASE || (IS_FB_TOKEN
  ? `https://graph.facebook.com/${process.env.IG_API_VERSION || 'v21.0'}`
  : `https://graph.instagram.com/${process.env.IG_API_VERSION || 'v26.0'}`)
const IG_USER_ID = process.env.IG_USER_ID || ''
const SITE = (process.env.SITE_URL || config.site).replace(/\/$/, '')
const MAX_LATE_HOURS = Number(process.env.MAX_LATE_HOURS || 48)
const MAX_ACTIONS = Number(process.env.MAX_ACTIONS || 20)
const COMMENT_MEDIA_DAYS = Number(process.env.COMMENT_MEDIA_DAYS || 30) // 回留言只看最近幾天的貼文（晚間每 5 分鐘那輪設 3，少打 API）
const now = new Date()
let actions = 0
let failures = 0

import { appendFileSync } from 'node:fs'
const summary = []
const log = (...a) => {
  const line = a.join(' ')
  console.log(line)
  summary.push(line)
}
const warn = (msg) => console.log(`::warning::${msg}`)

async function ig(method, path, params = {}) {
  const url = new URL(API + path)
  const init = { method, headers: { Authorization: `Bearer ${TOKEN}` } }
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  } else {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(params)
  }
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    const e = body.error || {}
    throw new Error(`IG API ${method} ${path} 失敗（${res.status}）：${e.message || JSON.stringify(body)}`)
  }
  return body
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 1. 發文 ----------
async function publish(me, post) {
  if (post.video) return publishReel(me, post)
  const urls = post.images.map((img) => imageUrl(SITE, img))
  for (const u of urls) {
    const res = await fetch(u, { method: 'HEAD' })
    const type = res.headers.get('content-type') || ''
    if (!res.ok || !type.includes('jpeg')) {
      warn(`${post.file}：圖片還沒上線或不是 JPEG（${res.status} ${type}）${u} — 下次再試`)
      return false
    }
  }
  if (DRY) {
    log(`[試跑] 會發文 ${post.file}（${urls.length} 張圖）`)
    return true
  }
  let containerId
  if (urls.length === 1) {
    containerId = (await ig('POST', `/${me.userId}/media`, { image_url: urls[0], caption: post.caption })).id
  } else {
    const children = []
    for (const u of urls) {
      children.push((await ig('POST', `/${me.userId}/media`, { image_url: u, is_carousel_item: true })).id)
    }
    for (const c of children) await waitReady(c)
    containerId = (await ig('POST', `/${me.userId}/media`, {
      media_type: 'CAROUSEL', children: children.join(','), caption: post.caption,
    })).id
  }
  await waitReady(containerId)
  const media = await ig('POST', `/${me.userId}/media_publish`, { creation_id: containerId })
  log(`✅ 已發文 ${post.file} → media ${media.id}`)
  return true
}

// Reels：影片放在網站 public/ig/，IG 自己來下載、轉檔，通常要 1～3 分鐘
async function publishReel(me, post) {
  const url = imageUrl(SITE, post.video)
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  const type = res.headers.get('content-type') || ''
  // GitHub Releases 的 mp4 會轉址到 octet-stream，也接受
  if (!res.ok || !(type.includes('mp4') || type.includes('octet-stream') || /\.mp4(\?|$)/i.test(url))) {
    warn(`${post.file}：影片還沒上線或不是 mp4（${res.status} ${type}）${url} — 下次再試`)
    return false
  }
  if (DRY) {
    log(`[試跑] 會發 Reels ${post.file}（${post.video}）`)
    return true
  }
  const params = { media_type: 'REELS', video_url: url, caption: post.caption, share_to_feed: true }
  if (post.thumbOffset !== null) params.thumb_offset = post.thumbOffset
  const containerId = (await ig('POST', `/${me.userId}/media`, params)).id
  await waitReady(containerId, 60) // 影片最多等 10 分鐘
  const media = await ig('POST', `/${me.userId}/media_publish`, { creation_id: containerId })
  log(`✅ 已發 Reels ${post.file} → media ${media.id}`)
  return true
}

async function waitReady(id, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const { status_code } = await ig('GET', `/${id}`, { fields: 'status_code' })
    if (status_code === 'FINISHED') return
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`IG 處理圖片或影片失敗（${status_code}）`)
    await sleep(10_000)
  }
  throw new Error(`IG 處理圖片或影片超過 ${tries * 10 / 60} 分鐘`)
}

async function runPosts(me) {
  const posts = loadPosts(join(here, 'posts'))
  let bad = 0
  for (const p of posts) {
    const problems = validatePost(p)
    if (problems.length) {
      bad++
      warn(`${p.file} 有問題，先跳過：${problems.join('；')}`)
    }
  }
  const valid = posts.filter((p) => validatePost(p).length === 0)
  const due = duePosts(valid, now, MAX_LATE_HOURS)
  const upcoming = valid.filter((p) => p.status === 'ready' && p.publishAt > now)
  log(`貼文：共 ${posts.length} 篇，排程中 ${upcoming.length} 篇，現在該發 ${due.length} 篇${bad ? `，${bad} 篇有問題` : ''}`)
  if (due.length === 0) return
  const recent = (await ig('GET', `/${me.userId}/media`, { fields: 'id,caption,timestamp,media_type,media_product_type', limit: 25 })).data || []
  for (const post of due) {
    if (alreadyPosted(post, recent)) { log(`${post.file} 已在 IG 上（文案相同），跳過`); continue }
    try {
      if (await publish(me, post)) return // 一次執行只發一篇，避免洗版
    } catch (e) {
      failures++
      warn(`${post.file} 發文失敗：${e.message}`)
    }
  }
}

// ---------- 2. 回留言 ----------
async function runComments(me) {
  const media = (await ig('GET', `/${me.userId}/media`, { fields: 'id,timestamp', limit: 10 })).data || []
  const recentMedia = media.filter((m) => (now - new Date(m.timestamp)) / 86400_000 <= COMMENT_MEDIA_DAYS)
  let replied = 0
  for (const m of recentMedia) {
    const comments = (await ig('GET', `/${m.id}/comments`, {
      fields: 'id,text,username,timestamp,from,replies{username,from}', limit: 50,
    })).data || []
    for (const c of comments) {
      if (actions >= MAX_ACTIONS) return
      // 規則可加 dates: ["YYYY-MM-DD"]，只對那幾天發的貼文生效（例如 1/2/3 在不同天代表不同選項）
      const postDate = new Date(new Date(m.timestamp).getTime() + 8 * 3600e3).toISOString().slice(0, 10)
      const rules = (config.rules || []).filter((r) => !r.dates || r.dates.includes(postDate))
      const plan = planCommentReply(c, me, { ...config, rules }, now)
      if (!plan) continue
      actions++
      if (DRY) {
        log(`[試跑] 會回覆 @${c.username} 的留言「${c.text}」（規則 ${plan.rule}）`)
        continue
      }
      try {
        let publicText = plan.publicText
        if (plan.privateText) {
          try {
            await ig('POST', `/${me.userId}/messages`, {
              recipient: { comment_id: c.id }, message: { text: plan.privateText },
            })
          } catch (e) {
            warn(`私訊 @${c.username} 失敗，改成公開回覆：${e.message}`)
            publicText = plan.fallbackText || publicText
          }
        }
        if (publicText) await ig('POST', `/${c.id}/replies`, { message: publicText })
        replied++
        log(`💬 已回覆 @${c.username}（規則 ${plan.rule}）`)
      } catch (e) {
        failures++
        warn(`回覆留言失敗：${e.message}`)
      }
    }
  }
  log(`留言：檢查 ${recentMedia.length} 篇貼文，回覆 ${replied} 則`)
}

// ---------- 3. 回私訊 ----------
async function listConversations(me) {
  const params = { fields: 'id,updated_time', limit: 20 }
  const base = IS_FB_TOKEN ? `/${me.userId}/conversations` : '/me/conversations'
  try {
    return (await ig('GET', base, { ...params, platform: 'instagram' })).data || []
  } catch {
    return (await ig('GET', base, params)).data || []
  }
}

async function loadMessages(convId) {
  const data = (await ig('GET', `/${convId}`, {
    fields: 'messages.limit(25){id,created_time,from,message}',
  })).messages?.data || []
  // 有些情況只回傳 id，再一則一則查內容
  const out = []
  for (const m of data) {
    out.push(m.from ? m : await ig('GET', `/${m.id}`, { fields: 'id,created_time,from,message' }))
  }
  return out
}

async function runDms(me) {
  const convs = (await listConversations(me)).filter((c) => (now - new Date(c.updated_time)) / 3600_000 <= 24)
  let replied = 0
  for (const conv of convs) {
    if (actions >= MAX_ACTIONS) return
    const plan = planDmReply(await loadMessages(conv.id), me, config, now)
    if (!plan?.recipientId) continue
    actions++
    if (DRY) {
      log(`[試跑] 會私訊回覆（規則 ${plan.rule}）：${plan.text.slice(0, 60)}…`)
      continue
    }
    try {
      await ig('POST', `/${me.userId}/messages`, { recipient: { id: plan.recipientId }, message: { text: plan.text } })
      replied++
      log(`📩 已回私訊（規則 ${plan.rule}）`)
    } catch (e) {
      failures++
      warn(`回私訊失敗：${e.message}`)
    }
  }
  log(`私訊：24 小時內有動靜的對話 ${convs.length} 個，回覆 ${replied} 則`)
}

// ---------- 主程式 ----------
async function main() {
  if (!TOKEN) {
    log('::notice::還沒設定 IG_ACCESS_TOKEN，機器人先不動作。設定方法見 qingxing/instagram/README.md')
    return
  }
  let me
  if (IS_FB_TOKEN) {
    if (!IG_USER_ID) { console.log('::error::系統用戶權杖（EAA…）要搭配 IG_USER_ID（Settings → Variables 設 QX_IG_USER_ID，值是 Meta 開發者頁帳號名下那串數字）'); process.exit(1) }
    const info = await ig('GET', `/${IG_USER_ID}`, { fields: 'id,username' })
    me = { id: info.id, userId: info.id, username: info.username }
  } else {
    const info = await ig('GET', '/me', { fields: 'id,user_id,username' })
    me = { id: info.id, userId: info.user_id || info.id, username: info.username }
  }
  log(`IG 帳號：@${me.username}${DRY ? '（試跑模式，不會真的發文或回覆）' : ''}`)
  const steps = { post: runPosts, comments: runComments, dms: runDms }
  for (const t of TASKS) {
    if (!steps[t]) continue
    try {
      await steps[t](me)
    } catch (e) {
      failures++
      warn(`${t} 這一步失敗：${e.message}`)
    }
  }
  // 寫進 GitHub 執行摘要，打開那次執行就看得到
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### IG 機器人執行結果\n\n${summary.map((l) => `- ${l}`).join('\n')}\n`)
  }
  if (failures) {
    console.log(`::error::有 ${failures} 個動作失敗，看上面的黃色警告`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.log(`::error::${e.message}`)
  process.exit(1)
})
