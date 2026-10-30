// 跨裝置同步：外觀、AI 對話紀錄、偏好（城市、模型）存到私人日記 repo 的 sync/ 資料夾。
// API Key / GitHub Token 不上傳；換裝置時用「設定碼」複製（見 app.js 設定區）。
// 規則：每個區塊各自記錄最後修改時間，較新的一方勝出。
import { settings, lsGet, lsSet } from "./store.js";
import { headers, b64encode } from "./github.js";

const API = "https://api.github.com";
const repo = () => `${API}/repos/${settings.owner}/${settings.diaryRepo || "life-diary"}`;
const META_KEY = "lifedash.syncMeta"; // { [section]: { t, h, sha, d } }

const SETTINGS_KEY = "lifedash.settings";
const PREF_FIELDS = ["model", "city", "lat", "lon"];
const SECTIONS = {
  appearance: { key: "lifedash.appearance" },
  chat: { key: "lifedash.chat" },
  prefs: { key: SETTINGS_KEY },
};

function read(sec) {
  const v = lsGet(SECTIONS[sec].key, null);
  if (sec !== "prefs" || !v) return v;
  return Object.fromEntries(PREF_FIELDS.filter((f) => v[f] !== undefined).map((f) => [f, v[f]]));
}

function hash(v) {
  const s = JSON.stringify(v ?? null);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

let meta = {};
let onApply = {};
let suppress = false;
let pushTimer = null;
let running = null;
let status = { state: "idle", at: null, msg: "" };
const listeners = new Set();

const saveMeta = () => lsSet(META_KEY, meta);
function setStatus(state, msg = "") {
  status = { state, msg, at: state === "ok" ? new Date() : status.at };
  listeners.forEach((fn) => fn(status));
}
export const onSyncStatus = (fn) => { listeners.add(fn); fn(status); };

const enabled = () => !!(settings.githubToken && settings.owner);

async function gh(path, opts = {}) {
  const r = await fetch(`${repo()}${path}`, { cache: "no-store", ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (r.status === 404 && !opts.method) return null;
  if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
  return opts.raw ? r.text() : r.json();
}

async function remoteShas() {
  const list = await gh(`/contents/sync?ref=main`);
  return Object.fromEntries((Array.isArray(list) ? list : []).map((f) => [f.name.replace(/\.json$/, ""), f.sha]));
}

async function getRemote(sec) {
  const txt = await gh(`/contents/sync/${sec}.json?ref=main`, { raw: true, headers: { Accept: "application/vnd.github.raw+json" } });
  return txt ? JSON.parse(txt) : null; // { t, data }
}

function applyLocal(sec, data) {
  suppress = true;
  try {
    if (sec === "prefs") {
      lsSet(SETTINGS_KEY, { ...lsGet(SETTINGS_KEY, {}), ...data });
      Object.assign(settings, data);
    } else {
      lsSet(SECTIONS[sec].key, data);
    }
  } finally { suppress = false; }
}

// 本機改動 → 記時間、標記待上傳
function onLocalChange(key) {
  if (suppress) return;
  for (const [sec, { key: k }] of Object.entries(SECTIONS)) {
    if (k !== key) continue;
    const h = hash(read(sec));
    const m = meta[sec];
    if (m.h === h) continue;
    Object.assign(m, { h, t: Date.now(), d: true });
    saveMeta();
    schedulePush();
  }
}

function schedulePush(delay = 1500) {
  if (!enabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), delay);
}

async function putRemote(sec, m) {
  if (!m.t) m.t = Date.now(); // 第一次上傳：以這台為準
  const body = { t: m.t, device: navigator.userAgent.slice(0, 80), data: read(sec) };
  const j = await gh(`/contents/sync/${sec}.json`, {
    method: "PUT",
    body: JSON.stringify({
      message: `sync: ${sec}`,
      content: b64encode(JSON.stringify(body) + "\n"),
      branch: "main",
      ...(m.sha ? { sha: m.sha } : {}),
    }),
  });
  m.sha = j.content.sha; m.d = false;
}

async function runSync() {
  const changed = [];
  const shas = await remoteShas();
  for (const sec of Object.keys(SECTIONS)) {
    const m = meta[sec];
    const rsha = shas[sec];
    if (rsha && rsha !== m.sha) {
      const doc = await getRemote(sec);
      if (doc && doc.t > m.t) {
        applyLocal(sec, doc.data);
        Object.assign(m, { t: doc.t, h: hash(read(sec)), sha: rsha, d: false });
        changed.push(sec);
      } else {
        m.sha = rsha;
        if (doc && m.t > doc.t) m.d = true;
      }
    } else if (!rsha && read(sec) != null) {
      m.sha = null; m.d = true; // 雲端還沒有 → 由這台上傳
    }
    if (m.d) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await putRemote(sec, m); break; } catch (e) {
          if ((e.status !== 409 && e.status !== 422) || attempt) throw e;
          const s = (await remoteShas())[sec];
          const doc = s ? await getRemote(sec) : null;
          if (doc && doc.t > m.t) { applyLocal(sec, doc.data); Object.assign(m, { t: doc.t, h: hash(read(sec)), sha: s, d: false }); changed.push(sec); break; }
          m.sha = s || null;
        }
      }
    }
    saveMeta();
  }
  for (const sec of changed) try { onApply[sec]?.(); } catch (e) { console.warn("sync apply", sec, e); }
  return changed;
}

export async function syncNow() {
  if (!enabled()) { setStatus("off", "未設定 GitHub Token，只存在這台裝置"); return []; }
  if (running) return running;
  clearTimeout(pushTimer);
  setStatus("busy");
  running = runSync()
    .then((c) => { setStatus("ok"); return c; })
    .catch((e) => {
      setStatus("error", e.status === 404 || e.status === 403
        ? `無法寫入「${settings.diaryRepo || "life-diary"}」：請確認 Token 有它的 Contents 讀寫權限`
        : `同步失敗：${e.message}`);
      return [];
    })
    .finally(() => { running = null; });
  return running;
}

export function initSync(callbacks) {
  onApply = callbacks;
  meta = lsGet(META_KEY, {});
  for (const sec of Object.keys(SECTIONS)) {
    if (!meta[sec]) meta[sec] = { t: 0, h: hash(read(sec)), sha: null, d: false };
  }
  saveMeta();
  window.addEventListener("lifedash:local", (e) => onLocalChange(e.detail));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
    else if (Object.values(meta).some((m) => m.d)) syncNow();
  });
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60 * 1000);
  return syncNow();
}

/* ---------- 設定碼：把金鑰從一台裝置複製到另一台（不經過 GitHub） ---------- */
const CODE_FIELDS = ["anthropicKey", "githubToken", "owner", "tasksRepo", "diaryRepo", "model"];

export function exportCode() {
  const o = Object.fromEntries(CODE_FIELDS.filter((f) => settings[f]).map((f) => [f, settings[f]]));
  return "LD1." + b64encode(JSON.stringify(o));
}

export function parseCode(code) {
  const s = code.trim().replace(/\s+/g, "");
  if (!s.startsWith("LD1.")) throw new Error("這不是生活面板的設定碼");
  const bin = atob(s.slice(4));
  const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  return Object.fromEntries(CODE_FIELDS.filter((f) => typeof o[f] === "string" && o[f]).map((f) => [f, o[f]]));
}
