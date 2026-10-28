import { settings, loadSettings, saveSettings } from "./store.js";
import { loadTodos, addTodo, setTodoDone, loadProjects, listAiTasks } from "./github.js";
import { initChat } from "./chat.js";
import { initAppearance } from "./theme.js";

const $ = (id) => document.getElementById(id);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { config: null, markets: null, news: null, daily: null, todos: null, weather: null, projects: null, aiTasks: null };

// 資料先讀 raw.githubusercontent（Actions 更新後不必等 Pages 重新部署），失敗再讀本站
async function getData(name) {
  const raw = `https://raw.githubusercontent.com/${settings.owner}/${settings.dashboardRepo}/main/data/${name}?t=${Math.floor(Date.now() / 60000)}`;
  for (const url of [raw, `data/${name}?t=${Date.now()}`]) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch { /* try next */ }
  }
  return null;
}

const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/* ---------- 問候 ---------- */
function renderHeader() {
  const now = new Date();
  const h = now.getHours();
  $("greet").textContent = h < 5 ? "夜深了，早點休息" : h < 11 ? "早安 ☀️" : h < 14 ? "午安 🍱" : h < 18 ? "午後好 ☕" : "晚安 🌙";
  $("today").textContent = now.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function tickClock() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  $("sceneDate").textContent = now.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" });
}

/* ---------- 天氣（Open-Meteo，免金鑰） ---------- */
const WMO = {
  0: ["☀️", "晴朗"], 1: ["🌤", "大致晴朗"], 2: ["⛅", "多雲"], 3: ["☁️", "陰天"],
  45: ["🌫", "霧"], 48: ["🌫", "霧淞"], 51: ["🌦", "毛毛雨"], 53: ["🌦", "毛毛雨"], 55: ["🌧", "濃毛毛雨"],
  61: ["🌦", "小雨"], 63: ["🌧", "中雨"], 65: ["🌧", "大雨"], 66: ["🌧", "凍雨"], 67: ["🌧", "凍雨"],
  71: ["🌨", "小雪"], 73: ["🌨", "中雪"], 75: ["❄️", "大雪"], 77: ["🌨", "雪粒"],
  80: ["🌦", "陣雨"], 81: ["🌧", "強陣雨"], 82: ["⛈", "豪雨"], 85: ["🌨", "陣雪"], 86: ["🌨", "強陣雪"],
  95: ["⛈", "雷雨"], 96: ["⛈", "雷雨冰雹"], 99: ["⛈", "強雷雨冰雹"],
};

async function geocode(city) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
  const j = await r.json();
  if (!j.results?.length) throw new Error("找不到城市");
  return { lat: j.results[0].latitude, lon: j.results[0].longitude, name: j.results[0].name };
}

function renderCityTabs() {
  const cities = [...state.config.locations];
  if (!cities.some((c) => c.name === settings.city)) cities.push({ name: settings.city, lat: settings.lat, lon: settings.lon });
  $("cityTabs").innerHTML = cities.map((c, i) =>
    `<button class="${c.name === settings.city ? "active" : ""}" data-i="${i}">${esc(c.name)}</button>`).join("");
  $("cityTabs").onclick = (e) => {
    const c = cities[e.target.dataset?.i]; if (!c || c.name === settings.city) return;
    saveSettings({ city: c.name, lat: c.lat, lon: c.lon });
    loadWeather();
  };
}

async function loadWeather() {
  renderCityTabs();
  try {
    const { lat, lon } = settings;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&timezone=auto&forecast_days=5`;
    const w = await (await fetch(url)).json();
    state.weather = { city: settings.city, current: w.current, daily: w.daily };
    const [icon, desc] = WMO[w.current.weather_code] || ["🌡", ""];
    $("wIcon").textContent = icon;
    $("wTemp").textContent = `${Math.round(w.current.temperature_2m)}°`;
    $("wDesc").textContent = `${desc}・體感 ${Math.round(w.current.apparent_temperature)}°`;
    $("wMeta").innerHTML = `<span>💧 濕度 ${w.current.relative_humidity_2m}%</span><span>💨 ${w.current.wind_speed_10m} km/h</span>` +
      `<span>☂️ 降雨 ${w.daily.precipitation_probability_max[0] ?? "–"}%</span><span>🔆 UV ${w.daily.uv_index_max[0] ?? "–"}</span>`;
    $("wDays").innerHTML = w.daily.time.map((d, i) => {
      const day = i === 0 ? "今天" : new Date(d).toLocaleDateString("zh-TW", { weekday: "short" });
      return `<div class="w-day">${day}<b>${(WMO[w.daily.weather_code[i]] || ["🌡"])[0]}</b>${Math.round(w.daily.temperature_2m_max[i])}° / ${Math.round(w.daily.temperature_2m_min[i])}°</div>`;
    }).join("");
  } catch (e) {
    $("wDesc").textContent = "天氣載入失敗";
  }
}

/* ---------- 市場：重疊滑動卡片 ---------- */
let deckItems = [], deckIndex = 0, deckGroup = "全部";

function spark(points, up) {
  if (!points?.length) return "";
  const w = 300, h = 70, min = Math.min(...points), max = Math.max(...points), rng = max - min || 1;
  const xy = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - 6 - ((p - min) / rng) * (h - 12)}`);
  const color = up ? "var(--up)" : "var(--down)";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${xy.join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function fmtNum(n) {
  if (n == null) return "–";
  const a = Math.abs(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 3 : 4 });
}

function renderMarkets() {
  const m = state.markets;
  if (!m?.quotes?.length) { $("deck").innerHTML = `<p class="muted">尚無市場資料（GitHub Actions 第一次執行後就會出現）</p>`; return; }
  $("marketTime").textContent = `更新 ${fmtTime(m.updated)}`;
  const groups = ["全部", ...new Set(m.quotes.map((q) => q.group))];
  $("marketTabs").innerHTML = groups.map((g) => `<button class="${g === deckGroup ? "active" : ""}" data-g="${esc(g)}">${esc(g)}</button>`).join("");
  deckItems = m.quotes.filter((q) => deckGroup === "全部" || q.group === deckGroup);
  deckIndex = Math.min(deckIndex, deckItems.length - 1);
  $("deck").innerHTML = deckItems.map((q) => {
    const up = (q.change ?? 0) >= 0;
    return `<div class="mcard">
      <div class="m-head"><div><div class="m-name">${esc(q.name)}</div><div class="m-sym">${esc(q.symbol)}</div></div><span class="m-group">${esc(q.group)}</span></div>
      <div class="m-price">${fmtNum(q.price)} <small class="muted">${esc(q.currency || "")}</small></div>
      <div class="m-chg ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${fmtNum(Math.abs(q.change ?? 0))} (${(q.changePct ?? 0).toFixed(2)}%)
        <span class="muted">・1 個月 ${q.monthPct != null ? q.monthPct.toFixed(1) + "%" : "–"}</span></div>
      ${spark(q.history, (q.monthPct ?? 0) >= 0)}
    </div>`;
  }).join("");
  layoutDeck();
}

function layoutDeck(dragX = 0) {
  const cards = [...$("deck").children];
  const n = cards.length;
  cards.forEach((c, i) => {
    const rel = (i - deckIndex + n) % n; // 0 = 最上層
    if (rel === 0) {
      c.style.transform = `translateX(${dragX}px) rotate(${dragX / 25}deg)`;
      c.style.opacity = 1; c.style.zIndex = 100;
    } else if (rel < 4) {
      c.style.transform = `translateY(${-rel * 14}px) scale(${1 - rel * 0.06})`;
      c.style.opacity = 1 - rel * 0.25; c.style.zIndex = 100 - rel;
    } else {
      c.style.transform = `translateY(-56px) scale(.76)`;
      c.style.opacity = 0; c.style.zIndex = 0;
    }
    c.style.pointerEvents = rel === 0 ? "auto" : "none";
    c.classList.toggle("top", rel === 0);
  });
  $("deckDots").innerHTML = n <= 20 ? cards.map((_, i) => `<i class="${i === deckIndex ? "on" : ""}"></i>`).join("") : `${deckIndex + 1} / ${n}`;
}

function deckMove(step) {
  if (!deckItems.length) return;
  deckIndex = (deckIndex + step + deckItems.length) % deckItems.length;
  layoutDeck();
}

function initDeck() {
  const deck = $("deck");
  let startX = null, dx = 0, top = null;
  deck.addEventListener("pointerdown", (e) => {
    top = deck.children[deckIndex]; if (!top) return;
    startX = e.clientX; dx = 0; top.classList.add("dragging"); deck.setPointerCapture(e.pointerId);
  });
  deck.addEventListener("pointermove", (e) => {
    if (startX == null) return;
    dx = e.clientX - startX; layoutDeck(dx);
  });
  const end = () => {
    if (startX == null) return;
    top?.classList.remove("dragging"); startX = null;
    if (Math.abs(dx) > 60) deckMove(dx < 0 ? 1 : -1); else layoutDeck();
  };
  deck.addEventListener("pointerup", end);
  deck.addEventListener("pointercancel", end);
  deck.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") deckMove(1); if (e.key === "ArrowLeft") deckMove(-1); });
  $("deckPrev").onclick = () => deckMove(-1);
  $("deckNext").onclick = () => deckMove(1);
  $("marketTabs").addEventListener("click", (e) => {
    const g = e.target.dataset?.g; if (!g) return;
    deckGroup = g; deckIndex = 0; renderMarkets();
  });
}

/* ---------- 新聞 ---------- */
let newsCat = "國際", newsSource = "全部";
function renderNews() {
  const n = state.news;
  if (!n) { $("newsList").innerHTML = `<li class="muted">尚無新聞資料</li>`; return; }
  $("newsTime").textContent = `更新 ${fmtTime(n.updated)}`;
  const catOf = (i) => i.category || "國際";
  const cats = [...new Set(["國際", "財經", ...n.items.map(catOf)])].filter((c) => n.items.some((i) => catOf(i) === c));
  if (!cats.includes(newsCat)) newsCat = cats[0] || "國際";
  $("newsCats").innerHTML = cats.map((c) => `<button class="${c === newsCat ? "active" : ""}" data-c="${esc(c)}">${c === "財經" ? "💹" : "🌍"} ${esc(c)}</button>`).join("");
  const brief = n.briefs?.[newsCat] ?? (newsCat === "國際" ? n.brief : []);
  $("newsBrief").innerHTML = (brief || []).map((b) => `<li>${esc(b)}</li>`).join("");
  const inCat = n.items.filter((i) => catOf(i) === newsCat);
  const sources = ["全部", ...new Set(inCat.map((i) => i.source))];
  if (!sources.includes(newsSource)) newsSource = "全部";
  $("newsTabs").innerHTML = sources.map((s) => `<button class="${s === newsSource ? "active" : ""}" data-s="${esc(s)}">${esc(s)}</button>`).join("");
  $("newsList").innerHTML = inCat.filter((i) => newsSource === "全部" || i.source === newsSource).slice(0, 40).map((i) =>
    `<li><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}<div class="n-meta">${esc(i.source)}・${fmtTime(i.published)}</div></a></li>`).join("");
}

/* ---------- 每日內容 ---------- */
function renderDaily() {
  const d = state.daily;
  if (!d) return;
  $("quoteText").textContent = d.encouragement?.text || "";
  $("quoteAuthor").textContent = d.encouragement?.author ? `— ${d.encouragement.author}` : "";
  const h = d.side_hustle || {};
  $("hustleTitle").textContent = h.title || "–";
  $("hustleSummary").textContent = h.summary || "";
  $("hustleSteps").innerHTML = (h.steps || []).map((s) => `<li>${esc(s)}</li>`).join("");
  $("hustleTags").innerHTML = [h.startup_cost && `💰 ${h.startup_cost}`, h.time_needed && `⏱ ${h.time_needed}`, h.potential && `📊 ${h.potential}`]
    .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("");
  const L = d.learning;
  if (L) {
    $("learnCat").textContent = L.category || "";
    $("learnTitle").textContent = L.title || "";
    $("learnContent").textContent = L.content || "";
    $("learnExamples").innerHTML = (L.examples || []).map((x) => `<li>${esc(x)}</li>`).join("");
    $("learnQ").textContent = L.practice || "";
    $("learnA").textContent = L.answer || "";
    $("learnPractice").hidden = !L.practice;
    $("learnPractice").open = false;
  }
  const idea = d.idea || {};
  $("ideaType").textContent = idea.type || "";
  $("ideaTitle").textContent = idea.title || "–";
  $("ideaDetail").textContent = idea.detail || "";
}

/* ---------- 代辦 ---------- */
async function refreshTodos() {
  try {
    const { data } = await loadTodos();
    state.todos = data;
    renderTodos();
  } catch (e) {
    $("todoList").innerHTML = "";
    $("todoHint").textContent = e.message;
  }
}

function renderTodos() {
  renderProjects();
  const items = (state.todos?.items || []).filter((t) => !t.project);
  const open = items.filter((t) => !t.done);
  $("todoMeta").textContent = `${open.length} 項未完成`;
  const sorted = [...open, ...items.filter((t) => t.done).slice(0, 5)];
  const pr = { high: "🔴", medium: "🟠", low: "⚪" };
  $("todoList").innerHTML = sorted.map((t) => `<li class="${t.done ? "done" : ""}">
    <input type="checkbox" data-id="${esc(t.id)}" ${t.done ? "checked" : ""} ${settings.githubToken ? "" : "disabled"}>
    <div><div class="t-title">${pr[t.priority] || ""} ${esc(t.title)}</div>
    <div class="t-meta">${t.due ? `📅 ${esc(t.due)}・` : ""}${esc(t.source || "")}${t.tags?.length ? "・#" + t.tags.map(esc).join(" #") : ""}</div></div></li>`).join("") ||
    `<li class="muted">沒有代辦，享受今天吧 🎉</li>`;
  $("todoHint").textContent = settings.githubToken ? `同步自 ${settings.owner}/${settings.tasksRepo}・${fmtTime(state.todos?.updated)}` : "唯讀模式：在設定填入 GitHub Token 即可新增 / 勾選";
}

function initTodos() {
  $("todoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("todoInput").value.trim(); if (!title) return;
    $("todoInput").value = "";
    $("todoHint").textContent = "同步中…";
    try { await addTodo({ title }, "dashboard"); await refreshTodos(); } catch (err) { $("todoHint").textContent = err.message; }
  });
  $("projBody").addEventListener("change", async (e) => {
    const id = e.target.dataset?.id; if (!id) return;
    $("projMeta").textContent = "同步中…";
    try { await setTodoDone(id, e.target.checked); await refreshTodos(); } catch (err) { $("projMeta").textContent = err.message; }
  });
  $("todoList").addEventListener("change", async (e) => {
    const id = e.target.dataset?.id; if (!id) return;
    $("todoHint").textContent = "同步中…";
    try { await setTodoDone(id, e.target.checked); await refreshTodos(); } catch (err) { $("todoHint").textContent = err.message; }
  });
}

/* ---------- 店語副業（life-tasks 的 projects.json） ---------- */
const DAY = 86400e3;
const tpeToday = () => new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }));
const daysUntil = (d) => Math.ceil((new Date(d) - tpeToday()) / DAY);

async function refreshProjects() {
  try {
    state.projects = await loadProjects();
  } catch (e) {
    state.projects = null;
    $("projBody").innerHTML = `<p class="muted small">${esc(e.message)}</p>`;
    return;
  }
  try {
    state.aiTasks = settings.githubToken ? await listAiTasks("open") : null;
  } catch { state.aiTasks = null; }
  renderProjects();
}

function todoRow(t) {
  const pr = { high: "🔴", medium: "🟠", low: "⚪" };
  const left = t.due && !t.done ? daysUntil(t.due) : null;
  const dueTxt = left == null ? "" : left < 0 ? `<span class="down">逾期 ${-left} 天</span>` : left === 0 ? `<span class="down">今天</span>` : `📅 ${esc(t.due.slice(5))}`;
  return `<li class="${t.done ? "done" : ""}"><input type="checkbox" data-id="${esc(t.id)}" ${t.done ? "checked" : ""} ${settings.githubToken ? "" : "disabled"}>
    <div><div class="t-title">${pr[t.priority] || ""} ${esc(t.title)}</div>${dueTxt ? `<div class="t-meta">${dueTxt}</div>` : ""}</div></li>`;
}

function bar(pct) {
  return `<div class="pbar"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(0)}%"></i></div>`;
}

function renderProjects() {
  const P = state.projects;
  if (!P) return;
  const todos = state.todos?.items || [];
  const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999");
  const html = P.projects.map((p) => {
    const mine = todos.filter((t) => t.project === p.id);
    const open = mine.filter((t) => !t.done).sort(byDue);
    const badge = p.status === "paused" ? `<span class="badge">⏸ 暫停中</span>` : `<span class="badge on">● 進行中</span>`;
    const links = (p.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("");
    let body = "";

    if (p.metrics) {
      body += `<div class="p-metrics">${p.metrics.map((m) => {
        const tgt = m.target ? `<small>/ ${m.target}</small>` : "";
        const due = m.due ? `<div class="muted small">${daysUntil(m.due) >= 0 ? `剩 ${daysUntil(m.due)} 天` : "已到期"}</div>` : "";
        return `<div class="p-metric"><div class="muted small">${esc(m.label)}</div><b>${m.value}</b>${tgt}${m.target ? bar((m.value / m.target) * 100) : ""}${due}</div>`;
      }).join("")}</div>`;
    }

    if (p.phases) {
      const start = new Date(p.start), end = new Date(p.end), now = tpeToday();
      const total = Math.round((end - start) / (7 * DAY));
      const week = Math.min(total, Math.max(1, Math.floor((now - start) / (7 * DAY)) + 1));
      const pct = ((now - start) / (end - start + DAY)) * 100;
      const phase = p.phases.find((ph) => now >= new Date(ph.start) && now <= new Date(ph.end)) || p.phases.at(now < start ? 0 : -1);
      const doneN = mine.filter((t) => t.done).length;
      body += `<div class="p-plan"><div class="p-row"><b>第 ${week} / ${total} 週</b><span class="muted small">${esc(p.start.slice(5))} – ${esc(p.end.slice(5))}・完成 ${doneN}/${mine.length} 項</span></div>
        ${bar(pct)}
        <div class="muted small">目前階段：${esc(phase.label)}「${esc(phase.title)}」${p.report ? `・成果回報 ${esc(p.report.slice(5))}（剩 ${daysUntil(p.report)} 天）` : ""}</div></div>`;
      const cur = open.filter((t) => t.tags?.includes(phase.label));
      const overdue = open.filter((t) => !t.tags?.includes(phase.label) && t.due && daysUntil(t.due) < 0);
      if (cur.length) body += `<div class="muted small p-sub">本階段待辦</div><ul class="todo-list">${cur.map(todoRow).join("")}</ul>`;
      if (overdue.length) body += `<details><summary class="muted small">之前階段未完成 ${overdue.length} 項</summary><ul class="todo-list">${overdue.map(todoRow).join("")}</ul></details>`;
    } else if (open.length) {
      body += `<div class="muted small p-sub">我的待辦</div><ul class="todo-list">${open.map(todoRow).join("")}</ul>`;
    }

    const ai = state.aiTasks?.filter((i) => i.labels.includes(p.id));
    const issuesUrl = `https://github.com/${settings.owner}/${settings.tasksRepo}/issues?q=is%3Aopen+label%3A${p.id}`;
    if (ai?.length) {
      body += `<details><summary class="muted small">🤖 AI 任務 ${ai.length} 項</summary><ul class="ai-list">${ai.map((i) =>
        `<li><a href="${esc(i.url)}" target="_blank" rel="noopener">#${i.number} ${esc(i.title.replace(/^\[[^\]]+\]\s*/, ""))}</a>${i.labels.includes("in-progress") ? ` <span class="badge on">處理中</span>` : ""}${i.labels.includes("on-hold") ? ` <span class="badge">暫緩</span>` : ""}${i.labels.includes("needs-user") ? ` <span class="badge warn">等你回覆</span>` : ""}</li>`).join("")}</ul></details>`;
    } else if (!settings.githubToken) {
      body += `<a class="muted small" href="${issuesUrl}" target="_blank" rel="noopener">查看 AI 任務 ↗</a>`;
    }

    return `<div class="proj ${p.status === "paused" ? "paused" : ""}">
      <div class="p-head"><b>${esc(p.emoji || "")} ${esc(p.name)}</b> ${badge}<span class="p-links">${links}</span></div>
      ${p.note && p.status === "paused" ? `<div class="muted small">${esc(p.note)}</div>` : ""}
      ${body}</div>`;
  }).join("");
  $("projBody").innerHTML = html;
  $("projMeta").textContent = `更新 ${fmtTime(P.updated)}`;
}

/* ---------- 設定 ---------- */
function initSettings() {
  const dlg = $("settings"), form = $("settingsForm");
  $("settingsBtn").onclick = () => {
    for (const k of ["anthropicKey", "githubToken", "owner", "tasksRepo", "city"]) form.elements[k].value = settings[k] || "";
    dlg.showModal();
  };
  dlg.addEventListener("close", async () => {
    if (dlg.returnValue !== "save") return;
    const f = form.elements;
    const patch = { anthropicKey: f.anthropicKey.value.trim(), githubToken: f.githubToken.value.trim(), owner: f.owner.value.trim(), tasksRepo: f.tasksRepo.value.trim() };
    const city = f.city.value.trim();
    if (city && city !== settings.city) {
      try { const g = await geocode(city); Object.assign(patch, { city, lat: g.lat, lon: g.lon }); } catch { alert("找不到這個城市，天氣維持原設定"); }
    }
    saveSettings(patch);
    loadWeather(); refreshTodos().then(refreshProjects);
  });
  $("locBtn").onclick = () => navigator.geolocation?.getCurrentPosition((p) => {
    saveSettings({ lat: p.coords.latitude, lon: p.coords.longitude, city: "目前位置" });
    loadWeather();
  }, () => alert("無法取得位置"));
  $("refreshBtn").onclick = () => loadAll();
}

async function loadAll() {
  renderHeader();
  const [markets, news, daily] = await Promise.all([getData("markets.json"), getData("news.json"), getData("daily.json")]);
  Object.assign(state, { markets, news, daily });
  renderMarkets(); renderNews(); renderDaily();
  loadWeather(); await refreshTodos(); refreshProjects();
}

async function main() {
  state.config = await (await fetch("config.json")).json();
  loadSettings(state.config);
  initAppearance(); initDeck(); initTodos(); initSettings();
  $("newsTabs").addEventListener("click", (e) => { const s = e.target.dataset?.s; if (s) { newsSource = s; renderNews(); } });
  $("newsCats").addEventListener("click", (e) => { const c = e.target.closest("[data-c]")?.dataset.c; if (c) { newsCat = c; newsSource = "全部"; renderNews(); } });
  initChat({ state, refreshTodos, openSettings: () => $("settingsBtn").click() });
  tickClock(); setInterval(tickClock, 15 * 1000);
  await loadAll();
  setInterval(loadAll, 15 * 60 * 1000);
}

main();
