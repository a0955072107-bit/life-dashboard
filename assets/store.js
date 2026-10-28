// 設定與本機儲存（localStorage 可能被封鎖，全部包 try/catch）
const KEY = "lifedash.settings";

export const settings = {
  anthropicKey: "",
  githubToken: "",
  owner: "",
  tasksRepo: "",
  dashboardRepo: "",
  city: "",
  lat: null,
  lon: null,
};

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
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
