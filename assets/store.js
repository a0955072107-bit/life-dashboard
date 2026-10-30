// 設定與本機儲存（localStorage 可能被封鎖，全部包 try/catch）
const KEY = "lifedash.settings";

export const settings = {
  anthropicKey: "",
  githubToken: "",
  owner: "",
  tasksRepo: "",
  diaryRepo: "life-diary",
  dashboardRepo: "",
  city: "",
  lat: null,
  lon: null,
};

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
// 內容有變才寫入，並通知同步模組（sync.js）
export function lsSet(key, value) {
  try {
    const s = JSON.stringify(value);
    if (localStorage.getItem(key) === s) return;
    localStorage.setItem(key, s);
  } catch { return; }
  window.dispatchEvent(new CustomEvent("lifedash:local", { detail: key }));
}

export function loadSettings(config) {
  Object.assign(settings, {
    owner: config.owner,
    tasksRepo: config.tasksRepo,
    dashboardRepo: config.dashboardRepo,
    city: config.locations[0].name,
    lat: config.locations[0].lat,
    lon: config.locations[0].lon,
  }, lsGet(KEY, {}));
}

export function saveSettings(patch) {
  Object.assign(settings, patch);
  lsSet(KEY, settings);
}
