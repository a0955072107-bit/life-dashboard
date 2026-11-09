// 機器人的「判斷邏輯」：只處理資料，不連網路，方便測試（test.mjs）。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------- 貼文檔 ----------

// 讀一個貼文檔：最上面 --- 之間是設定，下面整段是 IG 文案。
export function parsePostFile(text, fileName = '') {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`${fileName}：最上面要有 --- 包起來的設定區`)
  const meta = {}
  let listKey = null
  for (const raw of m[1].split('\n')) {
    if (/^\s*#/.test(raw)) continue // 整行註解
    const line = raw.replace(/\s+#.*$/, '').trimEnd()
    if (!line.trim()) continue
    const item = line.match(/^\s*-\s+(.+)$/)
    if (item && listKey) {
      meta[listKey].push(unquote(item[1].trim()))
      continue
    }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!kv) throw new Error(`${fileName}：看不懂這行設定「${raw}」`)
    const [, key, value] = kv
    if (value === '') {
      meta[key] = []
      listKey = key
    } else {
      meta[key] = unquote(value.trim())
      listKey = null
    }
  }
  const images = Array.isArray(meta.images) ? meta.images : meta.images ? [meta.images] : []
  return {
    file: fileName,
    publishAt: meta.publish_at ? new Date(meta.publish_at) : null,
    publishAtRaw: meta.publish_at || '',
    images,
    // Reels：video 放 mp4 路徑；thumb_offset 是封面取第幾毫秒（選填）
    video: typeof meta.video === 'string' ? meta.video : '',
    thumbOffset: meta.thumb_offset ? Number(meta.thumb_offset) : null,
    status: (meta.status || 'ready').toLowerCase(),
    caption: m[2].trim(),
  }
}

function unquote(s) {
  return s.replace(/^(['"])(.*)\1$/, '$2')
}

// 檢查貼文有沒有違反 IG 限制，回傳問題清單（空的就是 OK）。
export function validatePost(post) {
  const problems = []
  if (!post.publishAt || Number.isNaN(post.publishAt.getTime()))
    problems.push('publish_at 時間格式錯誤，範例：2026-11-03T09:00:00-05:00')
  else if (!/([+-]\d\d:\d\d|Z)$/.test(post.publishAtRaw))
    problems.push('publish_at 要寫時區，例如 -05:00（美東冬令時間）或 +08:00（台灣）')
  if (post.video) {
    if (!/\.mp4$/i.test(post.video)) problems.push(`Reels 影片要是 mp4：${post.video}`)
    if (post.images.length) problems.push('Reels 貼文不能同時放 images（只放 video）')
    if (post.thumbOffset !== null && !(post.thumbOffset >= 0)) problems.push('thumb_offset 要是 0 以上的毫秒數')
  } else {
    if (post.images.length === 0) problems.push('至少要一張圖（images），或改放影片（video）')
    if (post.images.length > 10) problems.push('輪播最多 10 張圖')
  }
  for (const img of post.images) {
    if (!/\.jpe?g$/i.test(img)) problems.push(`IG API 只接受 JPEG：${img}`)
  }
  if (!post.caption) problems.push('文案是空的')
  if ([...post.caption].length > 2200) problems.push('文案超過 2200 字元')
  const tags = post.caption.match(/#[\p{L}\p{N}_]+/gu) || []
  if (tags.length > 30) problems.push(`hashtag 超過 30 個（現在 ${tags.length} 個）`)
  if (!['ready', 'draft'].includes(post.status)) problems.push('status 只能是 ready 或 draft')
  return problems
}

export function loadPosts(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort()
    .map((f) => parsePostFile(readFileSync(join(dir, f), 'utf8'), f))
}

// 圖片放在 repo 的 qingxing/ig/，GitHub Pages 部署後就有公開網址。
export function imageUrl(siteUrl, img) {
  if (/^https?:\/\//.test(img)) return img
  return siteUrl.replace(/\/$/, '') + '/' + img.replace(/^\/?(public\/)?/, '')
}

// 用文案比對 IG 上最近的貼文，判斷這篇是不是已經發過（不需要另外記錄）。
export function normalizeCaption(s = '') {
  return s.replace(/\s+/g, ' ').trim().slice(0, 300).toLowerCase()
}

// 同一天的圖卡與 Reel 文案可能很像，所以只跟「同類型」的已發貼文比（影片只跟影片比，圖卡只跟圖卡比）
export function alreadyPosted(post, recentMedia) {
  const key = normalizeCaption(post.caption)
  const isVideo = Boolean(post.video)
  return recentMedia.some((m) => {
    const mVideo = m.media_type === 'VIDEO' || m.media_product_type === 'REELS'
    if (m.media_type && mVideo !== isVideo) return false
    return normalizeCaption(m.caption) === key
  })
}

// 該發的貼文：狀態 ready、時間已到、但沒有晚太久（避免一次補發一堆舊貼文）。
export function duePosts(posts, now, maxLateHours) {
  const earliest = now.getTime() - maxLateHours * 3600_000
  return posts
    .filter((p) => p.status === 'ready' && p.publishAt && !Number.isNaN(p.publishAt.getTime()))
    .filter((p) => p.publishAt.getTime() <= now.getTime() && p.publishAt.getTime() >= earliest)
    .sort((a, b) => a.publishAt - b.publishAt)
}

// ---------- 自動回覆規則 ----------

// 關鍵字比對：英文單字要整個字相符（"cost" 不會對到 "costume"），片語用包含。
// 規則可加 lang：'en' 只在訊息「沒有中文字」時比對（中文訊息夾 google、review 不會回英文）；
// 'zh' 只在訊息有中文字時比對。沒寫 lang 的規則一律比對。
const HAS_CJK = /[\u3400-\u9fff\uf900-\ufaff]/
// 對方在拒絕：不自動回，留給你看（寧可少回，不要對拒絕的人推銷）。
// 一句一句看：「要不要錢」「不用登入嗎」「已經有 IG 了，想問方案」是在問問題，不算拒絕；
// 「要收費？那不用了」「不要再傳方案了好嗎」算拒絕。
const NOT_DECLINE = /要不要|需不需要|不要緊|不用客氣|不用謝|不了解/g
const WANTS_TO_ASK = /想問|請問|想了解/
const ALWAYS_DECLINE = /不用了|別再|不要再|請勿|太貴|好貴|太高|too expensive|too high|please stop/i
const DECLINE = /不用|不需要|不要|不必|不考慮|沒興趣|沒有興趣|不感興趣|不想|不做|沒預算|已經有|不了|算了|沒有需要|no thanks|no thank you|no need|not interested|don'?t need|don'?t want|do not need|do not want|^\s*(no|stop)\s*$/i
export function isDecline(text) {
  const t = (text || '').replace(/’/g, "'").replace(NOT_DECLINE, '')
  if (ALWAYS_DECLINE.test(t)) return true
  if (WANTS_TO_ASK.test(t)) return false
  const parts = t.match(/[^，,。.！!？?\n]+[？?]?/g) || []
  return parts.some((p) => DECLINE.test(p.replace(/[？?]$/, '')) && !/[嗎？?]/.test(p))
}

// exact_keywords：整則訊息（去掉標點）就是這個字才算，例如 free（I am free tomorrow 不算）
const stripPunct = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export function matchRule(text, rules) {
  if (isDecline(text)) return null
  // 客人傳的連結（Google 地圖、IG）不算關鍵字
  const t = ` ${(text || '').replace(/(https?:\/\/|www\.)\S+|[\w-]+\.(com|tw|net|org|io|me|ee)(\/\S*)?/gi, ' ').toLowerCase()} `
  const hasCjk = HAS_CJK.test(t)
  const bare = stripPunct(text || '')
  for (const rule of rules) {
    if (rule.lang === 'en' && hasCjk) continue
    if (rule.lang === 'zh' && !hasCjk) continue
    if ((rule.exclude || []).some((x) => t.includes(x))) continue
    if ((rule.exact_keywords || []).some((k) => stripPunct(k) === bare)) return rule
    for (const kw of rule.keywords || []) {
      const k = kw.toLowerCase().trim()
      if (!k) continue
      const isWord = /^[a-z0-9]+$/.test(k)
      const hit = isWord ? new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(t) : t.includes(k)
      if (hit) return rule
    }
  }
  return null
}

export function fillTemplate(tpl, vars) {
  return (tpl || '').replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all)).trim()
}

// 留言要不要回、怎麼回。回傳 null 代表不處理。
export function planCommentReply(comment, me, config, now) {
  if (!comment?.id || !comment.text) return null
  const author = (comment.username || comment.from?.username || '').toLowerCase()
  if (!author || author === me.username.toLowerCase()) return null
  const ageDays = (now - new Date(comment.timestamp)) / 86400_000
  if (ageDays > 7) return null // IG 私訊回覆只能在 7 天內
  const replies = comment.replies?.data || []
  if (replies.some((r) => (r.username || r.from?.username || '').toLowerCase() === me.username.toLowerCase()))
    return null // 已經回過（不管是機器人還是你手動回的）
  if (isDecline(comment.text) || !isCommentRequest(comment.text, me, config.rules || [])) return null
  const vars = { username: comment.username || comment.from?.username, site: config.site }
  const rule = matchRule(comment.text, config.rules || [])
  if (rule) {
    const publicText = fillTemplate(rule.comment_reply, vars)
    const privateText = fillTemplate(rule.private_reply, vars)
    if (!publicText && !privateText) return null
    // 私訊送不出去時，改用這句公開回覆（不要說「已私訊」）
    const fallbackText = fillTemplate(config.comment_fallback_reply, vars)
    return { rule: rule.name, publicText, privateText, fallbackText }
  }
  const fallback = fillTemplate(config.default_comment_reply, vars)
  return fallback ? { rule: '(default)', publicText: fallback, privateText: '' } : null
}

// 留言會公開回覆又私訊報價，所以只回「真的在要資料」的留言：
// 整則只有關鍵字（可加「我要」「+1」），或有問句、意圖字。@ 別人、聊「這家」、講太長都不回。
const COMMENT_FILLER = /我要|想要|請給我|麻煩|謝謝|\+1|please|thanks/gi
const COMMENT_INTENT = /請問|想|多少|怎麼|如何|嗎|[？?]|\b(how|what|can you|do you)\b/i
function isCommentRequest(text, me, rules) {
  const t = text.replace(new RegExp(`@${me.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), ' ')
  if (t.includes('@') || /這(家|間|裡|邊)/.test(t)) return false
  const bare = stripPunct(t.replace(COMMENT_FILLER, ' '))
  const keywords = rules.flatMap((r) => [...(r.keywords || []), ...(r.exact_keywords || [])]).map(stripPunct)
  if (keywords.includes(bare)) return true
  const tooLong = HAS_CJK.test(t) ? stripPunct(t).length > 20 : t.trim().split(/\s+/).length > 8
  return !tooLong && COMMENT_INTENT.test(t)
}

function isFromMe(msg, me) {
  const u = (msg.from?.username || '').toLowerCase()
  if (u && u === me.username.toLowerCase()) return true
  const id = String(msg.from?.id || '')
  return id !== '' && (id === String(me.userId) || id === String(me.id))
}

// 私訊要不要回、怎麼回。messages 是一個對話裡最近的訊息（任何順序）。
export function planDmReply(messages, me, config, now) {
  const list = [...messages].sort((a, b) => new Date(b.created_time) - new Date(a.created_time))
  if (list.length === 0) return null
  const latest = list[0]
  if (isFromMe(latest, me)) return null // 最後一則是我們發的，不用回
  if ((now - new Date(latest.created_time)) / 3600_000 > 23.5) return null // 超過 24 小時不能自動回
  const customer = latest.from || {}
  // 收集「我們上一次回覆之後」客人傳的文字
  const newTexts = []
  for (const m of list) {
    if (isFromMe(m, me)) break
    if (m.message) newTexts.unshift(m.message)
  }
  const mine = list.filter((m) => isFromMe(m, me))
  const vars = { username: customer.username || 'there', site: config.site }
  // 比對前統一換行、空白和 emoji 變體字元；{username} 不管當時填什麼都算符合
  const norm = (x) => (x || '').replace(/\uFE0F/g, '').replace(/\s+/g, ' ').trim()
  const toRegex = (tpl) => {
    const body = norm(fillTemplate(tpl, { site: config.site }))
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{username\\\}/g, '\\S+')
    return new RegExp(`^${body}$`)
  }
  const isTpl = (msg, tpl) => toRegex(tpl).test(norm(msg.message))
  const ruleTpls = (config.rules || []).flatMap((r) => [r.dm_reply, r.private_reply]).filter(Boolean)
  const welcome = config.default_dm_reply
  const isWelcome = (m) => welcome && isTpl(m, welcome)
  const isRuleReply = (m) => ruleTpls.some((tpl) => isTpl(m, tpl))
  // 我方訊息只要有一則不是機器人範本，就是你親自在談：完全不插話
  if (mine.some((m) => !isWelcome(m) && !isRuleReply(m))) return null
  // 已經回過一段規則範本：接下來可能在補資料或追問，留給你回（歡迎詞之後回「方案」照常回）
  if (mine.some(isRuleReply)) return null
  if (newTexts.some(isDecline)) return null
  const joined = newTexts.join(' \n ')
  const rule = matchRule(joined, config.rules || [])
  if (rule && rule.dm_reply) return { rule: rule.name, recipientId: customer.id, text: fillTemplate(rule.dm_reply, vars) }
  if (mine.length === 0 && config.default_dm_reply)
    return { rule: '(welcome)', recipientId: customer.id, text: fillTemplate(config.default_dm_reply, vars) }
  return null // 對不到規則：留給你自己回
}
