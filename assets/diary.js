// 日記本：存在私人 repo（預設 life-diary）的 entries/YYYY-MM.json，每月一個檔
import { settings } from "./store.js";
import { headers, b64encode, b64decode } from "./github.js";

const $ = (id) => document.getElementById(id);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const API = "https://api.github.com";
const repo = () => `${API}/repos/${settings.owner}/${settings.diaryRepo || "life-diary"}`;

export const MOODS = ["😄", "🙂", "😐", "😔", "😢", "😡", "😴", "🥰", "🤒", "🤩"];
const WEEK = "日一二三四五六";

const tpeDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
const tpeTime = () => new Date().toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });

/* ---------- GitHub 存取 ---------- */
const cache = new Map(); // month -> { entries, sha }

async function api(path, opts = {}) {
  if (!settings.githubToken) throw new Error("需要在 ⚙ 設定填入 GitHub Token（並允許存取日記 repo）");
  const r = await fetch(`${repo()}${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) }, cache: "no-store" });
  if (r.status === 404 && (!opts.method || opts.method === "GET")) return null;
  if (r.status === 404 || r.status === 403) throw new Error(`無法存取日記 repo「${settings.diaryRepo || "life-diary"}」：請確認 repo 已建立，且 GitHub Token 有它的 Contents 讀寫權限`);
  if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

export async function loadMonth(month, force = false) {
  if (!force && cache.has(month)) return cache.get(month);
  const j = await api(`/contents/entries/${month}.json?ref=main`);
  const v = j ? { entries: JSON.parse(b64decode(j.content)).entries || [], sha: j.sha } : { entries: [], sha: null };
  cache.set(month, v);
  return v;
}

async function saveMonth(month, mutate) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await loadMonth(month, true);
    const result = mutate(cur.entries);
    cur.entries.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    try {
      const j = await api(`/contents/entries/${month}.json`, {
        method: "PUT",
        body: JSON.stringify({
          message: `diary: ${month}`,
          content: b64encode(JSON.stringify({ month, entries: cur.entries }, null, 2) + "\n"),
          ...(cur.sha ? { sha: cur.sha } : {}),
          branch: "main",
        }),
      });
      cur.sha = j.content.sha;
      return result;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e; // 衝突就重讀再試一次
    }
  }
  throw new Error("日記同時被修改，請再按一次儲存");
}

export async function listMonths() {
  const j = await api(`/contents/entries?ref=main`);
  return (j || []).map((f) => f.name.replace(/\.json$/, "")).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
}

export async function saveEntry(entry) {
  const month = entry.date.slice(0, 7);
  // 改日期時要從舊月份移除
  if (entry._oldMonth && entry._oldMonth !== month) await saveMonth(entry._oldMonth, (list) => { const i = list.findIndex((e) => e.id === entry.id); if (i >= 0) list.splice(i, 1); });
  const { _oldMonth, ...clean } = entry;
  clean.updated = new Date().toISOString();
  await saveMonth(month, (list) => {
    const i = list.findIndex((e) => e.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
  });
  return clean;
}

export async function deleteEntry(entry) {
  await saveMonth(entry.date.slice(0, 7), (list) => { const i = list.findIndex((e) => e.id === entry.id); if (i >= 0) list.splice(i, 1); });
}

/* ---------- 畫面 ---------- */
let viewMonth = tpeDate().slice(0, 7);
let selectedDay = null;
let editing = null; // 正在編輯的日記（null = 新的）

function moodPicker(el, value) {
  el.innerHTML = MOODS.map((m) => `<button type="button" class="${m === value ? "active" : ""}" data-m="${m}">${m}</button>`).join("");
  el.dataset.value = value || "";
}

function entryCard(e, full = false) {
  const d = new Date(e.date);
  const text = full ? esc(e.text).replace(/\n/g, "<br>") : esc(e.text.length > 90 ? e.text.slice(0, 90) + "…" : e.text);
  return `<article class="d-entry" data-id="${esc(e.id)}" data-month="${e.date.slice(0, 7)}">
    <div class="d-entry-head"><span class="d-mood">${e.mood || "📝"}</span>
      <div><b>${esc(e.title || "（無標題）")}</b><div class="muted small">${e.date}（${WEEK[d.getDay()]}）${esc(e.time || "")}${e.tags?.length ? "・#" + e.tags.map(esc).join(" #") : ""}</div></div></div>
    <div class="d-text">${text}</div></article>`;
}

function fillForm(e) {
  editing = e || null;
  $("dDate").value = e?.date || tpeDate();
  $("dTitle").value = e?.title || "";
  $("dText").value = e?.text || "";
  $("dTags").value = (e?.tags || []).join(" ");
  moodPicker($("dMood"), e?.mood || "");
  $("dDelete").hidden = !e;
  $("dFormTitle").textContent = e ? "編輯日記" : "寫日記";
  $("dStatus").textContent = "";
}

async function onSave(ev) {
  ev.preventDefault();
  const text = $("dText").value.trim();
  if (!text) { $("dStatus").textContent = "內容是空的"; return; }
  const entry = {
    id: editing?.id || `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: $("dDate").value || tpeDate(),
    time: editing?.time || tpeTime(),
    title: $("dTitle").value.trim(),
    mood: $("dMood").dataset.value || "",
    tags: $("dTags").value.split(/[\s,，#]+/).filter(Boolean),
    text,
    created: editing?.created || new Date().toISOString(),
    _oldMonth: editing?.date.slice(0, 7),
  };
  $("dStatus").textContent = "儲存中…";
  try {
    await saveEntry(entry);
    try { localStorage.removeItem("lifedash.diaryDraft"); } catch { /* ignore */ }
    $("dStatus").textContent = "✅ 已儲存";
    viewMonth = entry.date.slice(0, 7);
    selectedDay = entry.date;
    fillForm(null);
    await Promise.all([renderRecent(), $("diaryBook").open ? renderBook() : null]);
    $("dStatus").textContent = "✅ 已儲存";
  } catch (e) {
    $("dStatus").textContent = e.message;
  }
}

async function renderRecent() {
  const box = $("diaryRecent");
  if (!settings.githubToken) { box.innerHTML = `<p class="muted small">在 ⚙ 設定填入 GitHub Token 後就能寫日記（存在私人 repo「${esc(settings.diaryRepo || "life-diary")}」）。</p>`; return; }
  try {
    const months = (await listMonths()).slice(0, 2);
    const all = (await Promise.all(months.map((m) => loadMonth(m)))).flatMap((x) => x.entries);
    all.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    const today = tpeDate();
    const streak = calcStreak(all.map((e) => e.date));
    $("diaryMeta").textContent = all.some((e) => e.date === today) ? `今天寫過了・連續 ${streak} 天` : streak ? `連續 ${streak} 天` : "";
    box.innerHTML = all.slice(0, 3).map((e) => entryCard(e)).join("") || `<p class="muted small">還沒有日記，寫下第一篇吧 ✍️</p>`;
  } catch (e) {
    box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`;
  }
}

function calcStreak(dates) {
  const set = new Set(dates);
  let d = new Date(tpeDate()), n = 0;
  if (!set.has(tpeDate(d))) d.setDate(d.getDate() - 1); // 今天還沒寫，從昨天算
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

async function renderBook() {
  $("bookMonth").textContent = `${viewMonth.slice(0, 4)} 年 ${+viewMonth.slice(5)} 月`;
  $("bookList").innerHTML = `<p class="muted">載入中…</p>`;
  try {
    const { entries } = await loadMonth(viewMonth);
    const byDay = new Map();
    for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) || []), e]);
    // 月曆
    const [y, m] = viewMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
    const today = tpeDate();
    let cells = [...WEEK].map((w) => `<div class="cal-h">${w}</div>`).join("") + "<div></div>".repeat(first);
    for (let d = 1; d <= days; d++) {
      const ds = `${viewMonth}-${String(d).padStart(2, "0")}`;
      const es = byDay.get(ds);
      cells += `<button class="cal-d ${es ? "has" : ""} ${ds === today ? "today" : ""} ${ds === selectedDay ? "sel" : ""}" data-day="${ds}">
        <span>${d}</span>${es ? `<i>${es[0].mood || "•"}</i>` : ""}</button>`;
    }
    $("bookCal").innerHTML = cells;
    const list = selectedDay?.startsWith(viewMonth) ? byDay.get(selectedDay) || [] : entries;
    $("bookListTitle").textContent = selectedDay?.startsWith(viewMonth) ? `${selectedDay} 的日記` : `本月 ${entries.length} 篇`;
    $("bookList").innerHTML = list.map((e) => entryCard(e, true)).join("") ||
      `<p class="muted">${selectedDay ? "這天沒有日記。" : "這個月還沒有日記。"}</p>`;
  } catch (e) {
    $("bookList").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function search(q) {
  q = q.trim().toLowerCase();
  if (!q) { selectedDay = null; return renderBook(); }
  $("bookListTitle").textContent = "搜尋中…";
  const months = await listMonths();
  const all = (await Promise.all(months.map((m) => loadMonth(m)))).flatMap((x) => x.entries);
  const hits = all.filter((e) => [e.title, e.text, e.mood, ...(e.tags || [])].join(" ").toLowerCase().includes(q));
  $("bookListTitle").textContent = `「${q}」找到 ${hits.length} 篇`;
  $("bookList").innerHTML = hits.map((e) => entryCard(e, true)).join("") || `<p class="muted">沒有符合的日記。</p>`;
}

function findEntry(el) {
  const card = el.closest(".d-entry"); if (!card) return null;
  return cache.get(card.dataset.month)?.entries.find((e) => e.id === card.dataset.id) || null;
}

export function initDiary() {
  fillForm(null);
  // 草稿自動保存在本機，避免寫到一半關掉
  try { const dr = localStorage.getItem("lifedash.diaryDraft"); if (dr) $("dText").value = dr; } catch { /* ignore */ }
  $("dText").addEventListener("input", () => { if (!editing) try { localStorage.setItem("lifedash.diaryDraft", $("dText").value); } catch { /* ignore */ } });
  $("dMood").addEventListener("click", (e) => {
    const m = e.target.dataset?.m; if (!m) return;
    moodPicker($("dMood"), $("dMood").dataset.value === m ? "" : m);
  });
  $("diaryForm").addEventListener("submit", onSave);
  $("dCancel").onclick = () => fillForm(null);
  $("dDelete").onclick = async () => {
    if (!editing || !confirm("確定要刪除這篇日記嗎？刪除後無法復原。")) return;
    $("dStatus").textContent = "刪除中…";
    try { await deleteEntry(editing); fillForm(null); await Promise.all([renderRecent(), $("diaryBook").open ? renderBook() : null]); } catch (e) { $("dStatus").textContent = e.message; }
  };
  // 點日記 → 編輯
  const openEdit = (e) => {
    const entry = findEntry(e.target); if (!entry) return;
    $("diaryBook").close();
    fillForm(entry);
    $("diaryCard").scrollIntoView({ behavior: "smooth", block: "start" });
    $("dText").focus();
  };
  $("diaryRecent").addEventListener("click", openEdit);
  $("bookList").addEventListener("click", openEdit);
  // 日記本
  $("diaryOpen").onclick = () => { selectedDay = null; $("bookSearch").value = ""; $("diaryBook").showModal(); renderBook(); };
  $("bookClose").onclick = () => $("diaryBook").close();
  $("bookPrev").onclick = () => { const [y, m] = viewMonth.split("-").map(Number); viewMonth = tpeDate(new Date(y, m - 2, 15)).slice(0, 7); selectedDay = null; renderBook(); };
  $("bookNext").onclick = () => { const [y, m] = viewMonth.split("-").map(Number); viewMonth = tpeDate(new Date(y, m, 15)).slice(0, 7); selectedDay = null; renderBook(); };
  $("bookCal").addEventListener("click", (e) => {
    const d = e.target.closest("[data-day]")?.dataset.day; if (!d) return;
    selectedDay = selectedDay === d ? null : d; renderBook();
  });
  let t;
  $("bookSearch").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value).catch((err) => { $("bookList").innerHTML = `<p class="muted">${esc(err.message)}</p>`; }), 350); });
  $("bookNew").onclick = () => { $("diaryBook").close(); fillForm(null); if (selectedDay) $("dDate").value = selectedDay; $("diaryCard").scrollIntoView({ behavior: "smooth" }); $("dText").focus(); };
  renderRecent();
}

export const refreshDiary = renderRecent;
