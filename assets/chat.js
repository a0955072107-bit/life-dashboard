// AI 助手：瀏覽器直接呼叫 Claude API（金鑰只存在本機）
import { settings, lsGet, lsSet } from "./store.js";
import { addTodo, setTodoDone, loadTodos, createAiTask, listAiTasks } from "./github.js";

// 可在 ⚙ 設定切換。價格為每百萬 tokens 的輸入／輸出美元。
export const MODELS = {
  "claude-opus-5-5": { label: "Opus 5.5：最聰明（$4／$20）", search: "web_search_20260209", fallback: true },
  "claude-sonnet-5-5": { label: "Sonnet 5.5：均衡，約便宜一半（$2／$10）", search: "web_search_20260209", fallback: true },
  "claude-haiku-5-5": { label: "Haiku 5.5：最快最便宜（$0.1／$0.5）", search: "web_search_20250305", fallback: false },
};
export const DEFAULT_MODEL = "claude-opus-5-5";
const currentModel = () => (MODELS[settings.model] ? settings.model : DEFAULT_MODEL);
const HISTORY_KEY = "lifedash.chat";
const $ = (id) => document.getElementById(id);

const SYSTEM = `你是使用者的私人生活助手，住在他的「生活儀表板」網頁裡。一律使用繁體中文（台灣用語）回答，語氣親切、精簡、實用。

你能做的事：
- 聊天、提供建議、協助查詢與整理資料。需要即時或你不確定的資訊時，用 web_search 搜尋，並附上來源連結。
- 讀取儀表板上的資料（天氣、市場報價、國際與財經新聞、今日副業與想法、每日學習、代辦、副業專案 ShopVoice／店語文案的進度與 AI 任務）：呼叫 get_dashboard_snapshot。
- 管理代辦事項（存在 GitHub repo 的 todos.json）：list_todos / add_todo / complete_todo。新增前若日期或優先度不明確，可合理推斷，不必反覆追問。
- 建立「AI 任務」：當使用者想把一件需要較長時間、需要寫程式、整理文件或研究的工作交給其他 AI 工作階段處理時，用 create_ai_task 在 GitHub 開一個 issue。任務內容要寫成其他 AI 不需上下文也能獨立執行的完整說明：目標、背景、具體步驟或要求、完成標準、產出放哪裡。
- 查看已建立的 AI 任務進度：list_ai_tasks。

投資相關問題提供資訊與觀點即可，提醒這不是投資建議，不要過度重複免責聲明。
做了會改變資料的動作（新增代辦、建立任務）後，簡短告訴使用者結果與連結。`;

const toolsFor = (model) => [
  { type: MODELS[model].search, name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "TW", timezone: "Asia/Taipei" } },
  ...TOOLS,
];

const TOOLS = [
  {
    name: "get_dashboard_snapshot",
    description: "取得儀表板目前顯示的所有資料：天氣、市場報價（美股/指數/黃金/匯率）、今日國際與財經新聞摘要與標題、今日副業發想、今日想法、每日學習、每日鼓勵、未完成代辦。回答與這些主題相關的問題前先呼叫。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "list_todos",
    description: "列出代辦事項（含 id、標題、是否完成、截止日、優先度）。",
    input_schema: { type: "object", properties: { include_done: { type: "boolean", description: "是否包含已完成項目" } }, additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "add_todo",
    description: "新增一筆代辦事項到使用者的 GitHub 代辦清單。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "代辦內容，簡短明確" },
        due: { type: "string", description: "截止日 YYYY-MM-DD（可省略）" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        project: { type: "string", enum: ["shopvoice", "dianyu"], description: "屬於哪個副業專案；一般生活代辦不要填" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "complete_todo",
    description: "把代辦標記為完成（或用 done=false 重新開啟）。需要先用 list_todos 取得 id。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, done: { type: "boolean" } },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "create_ai_task",
    description: "在 GitHub 任務 repo 建立一個 issue（標籤 ai-task），讓其他 AI 工作階段讀取並執行。body 用 Markdown，寫清楚目標、背景、步驟、完成標準。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" }, description: "額外標籤，例如 research、coding、finance；屬於副業專案時加 shopvoice 或 dianyu" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "list_ai_tasks",
    description: "列出 GitHub 上的 AI 任務 issue 與狀態。",
    input_schema: { type: "object", properties: { state: { type: "string", enum: ["open", "closed", "all"] } }, additionalProperties: false },
    eager_input_streaming: true,
  },
];

// 每個工具的必填欄位與型別；串流模式下 API 不再驗證輸入，所以自己檢查
const VALIDATORS = {
  add_todo: (i) => typeof i.title === "string" && i.title.trim(),
  complete_todo: (i) => typeof i.id === "string" && i.id,
  create_ai_task: (i) => typeof i.title === "string" && i.title && typeof i.body === "string" && i.body,
};

let ctx;          // { state, refreshTodos, openSettings }
let client = null;
let messages = lsGet(HISTORY_KEY, []);
let busy = false;

async function getClient() {
  if (!settings.anthropicKey) throw new Error("NO_KEY");
  if (!client || client.apiKey !== settings.anthropicKey) {
    const { default: Anthropic } = await import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm");
    client = new Anthropic({ apiKey: settings.anthropicKey, dangerouslyAllowBrowser: true });
  }
  return client;
}

function snapshot() {
  const { state } = ctx;
  return {
    now: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
    weather: state.weather,
    markets: state.markets?.quotes?.map(({ history, ...q }) => q),
    markets_updated: state.markets?.updated,
    news_briefs: state.news?.briefs ?? { 國際: state.news?.brief },
    news_headlines: state.news?.items?.slice(0, 40).map((i) => ({ title: i.title, category: i.category, source: i.source, link: i.link })),
    daily: state.daily,
    open_todos: state.todos?.items?.filter((t) => !t.done),
    projects: state.projects,
    open_ai_tasks: state.aiTasks,
  };
}

async function runTool(name, input) {
  if (VALIDATORS[name] && !VALIDATORS[name](input)) throw new Error(`INVALID_INPUT: ${JSON.stringify(input)}`);
  switch (name) {
    case "get_dashboard_snapshot": return snapshot();
    case "list_todos": {
      const { data } = await loadTodos();
      return data.items.filter((t) => input.include_done || !t.done);
    }
    case "add_todo": {
      const item = await addTodo(input, "ai-assistant");
      ctx.refreshTodos();
      return { ok: true, item };
    }
    case "complete_todo": {
      const t = await setTodoDone(input.id, input.done ?? true, "ai-assistant");
      ctx.refreshTodos();
      return { ok: true, item: t };
    }
    case "create_ai_task": {
      const body = `${input.body}\n\n---\n_由生活儀表板 AI 助手建立於 ${new Date().toLocaleString("zh-TW")}_`;
      return { ok: true, ...(await createAiTask({ ...input, body })) };
    }
    case "list_ai_tasks": return listAiTasks(input.state || "open");
    default: throw new Error(`未知工具 ${name}`);
  }
}

const TOOL_LABEL = {
  web_search: "🔎 搜尋網路", get_dashboard_snapshot: "📊 讀取儀表板資料", list_todos: "📋 讀取代辦",
  add_todo: "➕ 新增代辦", complete_todo: "✔️ 更新代辦", create_ai_task: "🛰 建立 AI 任務", list_ai_tasks: "🛰 查看 AI 任務",
};

/* ---------- 畫面 ---------- */
function md(text) {
  const e = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return e
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^#{1,4}\s*(.+)$/gm, "<b>$1</b>");
}

function bubble(role, text = "") {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "ai") el.innerHTML = md(text); else el.textContent = text;
  $("chatLog").appendChild(el);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
  return el;
}

function renderHistory() {
  $("chatLog").innerHTML = "";
  for (const m of messages) {
    if (typeof m.content === "string") { bubble(m.role === "user" ? "user" : "ai", m.content); continue; }
    for (const b of m.content) {
      if (m.role === "user" && b.type === "text" && !b.text.startsWith("（現在時間")) bubble("user", b.text);
      if (m.role === "assistant" && b.type === "text" && b.text.trim()) bubble("ai", b.text);
      if (m.role === "assistant" && (b.type === "tool_use" || b.type === "server_tool_use")) bubble("tool", TOOL_LABEL[b.name] || b.name);
    }
  }
  $("chatSuggest").style.display = messages.length ? "none" : "flex";
}

const save = () => lsSet(HISTORY_KEY, messages.slice(-80));

/* ---------- 對話迴圈 ---------- */
async function send(text) {
  if (busy || !text.trim()) return;
  let api;
  try { api = await getClient(); } catch (e) {
    bubble("ai", e.message === "NO_KEY" ? "請先在 ⚙ 設定填入 Anthropic API Key，我就能開始幫你了。" : `載入失敗：${e.message}`);
    if (e.message === "NO_KEY") ctx.openSettings();
    return;
  }
  busy = true; $("chatSend").disabled = true; $("chatSuggest").style.display = "none";
  bubble("user", text);
  const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "full", timeStyle: "short" });
  const startLen = messages.length;
  messages.push({ role: "user", content: [{ type: "text", text }, { type: "text", text: `（現在時間：${now}，台北）` }] });

  try {
    for (let turn = 0; turn < 12; turn++) {
      const el = bubble("ai", "…");
      let acc = "";
      const model = currentModel();
      $("chatModel").textContent = model;
      // 被安全機制拒絕時，Opus／Sonnet 可由伺服器自動改用備援模型；Haiku 不支援
      const fallback = MODELS[model].fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
      const stream = api.beta.messages.stream({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        tools: toolsFor(model),
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        ...fallback,
        messages,
      });
      stream.on("text", (d) => { acc += d; el.innerHTML = md(acc); $("chatLog").scrollTop = $("chatLog").scrollHeight; });
      const msg = await stream.finalMessage();
      if (!acc.trim()) el.remove();
      messages.push({ role: "assistant", content: msg.content });

      for (const b of msg.content) if (b.type === "server_tool_use") bubble("tool", TOOL_LABEL[b.name] || b.name);

      if (msg.stop_reason === "refusal") { bubble("tool", "（這個請求無法處理）"); break; }
      if (msg.stop_reason === "pause_turn") continue;
      const uses = msg.content.filter((b) => b.type === "tool_use");
      if (!uses.length) break;
      if (msg.stop_reason === "max_tokens") { bubble("tool", "（回覆過長被截斷，請再試一次）"); break; }

      const results = await Promise.all(uses.map(async (u) => {
        bubble("tool", TOOL_LABEL[u.name] || u.name);
        try {
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input ?? {})) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: u.id, content: String(err.message || err), is_error: true };
        }
      }));
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    const status = err?.status;
    bubble("ai", status === 401 ? "API Key 無效，請到設定確認。" : status === 429 ? "請求太頻繁，稍等一下再試。" : `發生錯誤：${err.message || err}`);
    // 失敗的這一輪整個捨棄，避免歷史留下未回覆的 tool_use
    messages.length = startLen;
  } finally {
    save();
    busy = false; $("chatSend").disabled = false;
  }
}

// 其他裝置同步過來時重新載入對話（正在回覆時先略過）
export function reloadChat() {
  if (busy) return;
  messages = lsGet(HISTORY_KEY, []);
  renderHistory();
  $("chatModel").textContent = currentModel();
}

export function initChat(c) {
  ctx = c;
  $("chatModel").textContent = currentModel();
  const panel = $("chatPanel");
  const toggle = (open) => { panel.classList.toggle("open", open); panel.setAttribute("aria-hidden", String(!open)); if (open) $("chatInput").focus(); };
  $("chatFab").onclick = () => toggle(!panel.classList.contains("open"));
  $("chatClose").onclick = () => toggle(false);
  $("chatClear").onclick = () => { messages = []; save(); renderHistory(); };
  $("chatForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("chatInput").value; $("chatInput").value = ""; send(v); });
  $("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("chatForm").requestSubmit(); }
  });
  $("chatInput").addEventListener("input", (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; });
  $("chatSuggest").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") send(e.target.textContent); });
  renderHistory();
}
