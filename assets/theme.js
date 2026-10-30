// 外觀：主題範例、玻璃模糊、圓角、動畫、區塊顯示
import { lsGet, lsSet } from "./store.js";

const KEY = "lifedash.appearance";
const $ = (id) => document.getElementById(id);
const root = document.documentElement;

export const THEMES = [
  { id: "auto", name: "跟隨系統", colors: ["#6a5cff", "#00c6ff", "#a69bff"], bg: "linear-gradient(135deg,#0b1026 50%,#dfe7ff 50%)" },
  { id: "aurora", name: "極光（預設）", colors: ["#6a5cff", "#00c6ff", "#ff5fa2"], bg: "#0b1026" },
  { id: "frost", name: "霧面白", colors: ["#a69bff", "#7fdcff", "#ffa6c9"], bg: "#dfe7ff" },
  { id: "sunset", name: "夕陽", colors: ["#ff6a3d", "#ff2e7e", "#ffb703"], bg: "#2a0f2e" },
  { id: "ocean", name: "深海", colors: ["#0077b6", "#00b4d8", "#2ec4b6"], bg: "#021c2b" },
  { id: "forest", name: "森林", colors: ["#2d6a4f", "#52b788", "#d4a373"], bg: "#0d1f14" },
  { id: "sakura", name: "櫻花", colors: ["#ffafcc", "#cdb4db", "#bde0fe"], bg: "#fde8ef" },
  { id: "mono", name: "極簡黑", colors: ["#3a3a3a", "#5a5a5a", "#777"], bg: "#0a0a0a" },
  { id: "cyber", name: "賽博霓虹", colors: ["#7b2ff7", "#00f0ff", "#ff2079"], bg: "#07010f" },
];

// 冰山風景（Unsplash，需標示攝影師）
const U = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=2400&q=80`;
export const WALLPAPERS = [
  { id: "berg-reflect", name: "冰山倒影", url: U("photo-1778513811576-7a865312e59e"), by: "Dave Meckler", link: "https://unsplash.com/photos/VkGStDAsxKc" },
  { id: "berg-antarctica", name: "南極冰山", url: U("photo-1646282014691-620f9af448a8"), by: "Rod Long", link: "https://unsplash.com/photos/ZP2JLBqRY0k" },
  { id: "berg-greenland", name: "格陵蘭冰山", url: U("photo-1564148204877-9bf116988675"), by: "Xavier Balderas Cejudo", link: "https://unsplash.com/photos/kxIE049IZ1g" },
  { id: "berg-blue", name: "藍色浮冰", url: U("photo-1768386709566-cb8388a92845"), by: "Adi Albulescu", link: "https://unsplash.com/photos/CnofAJKt0Xc" },
  { id: "berg-birds", name: "北極海鳥", url: U("photo-1791017384197-b04e4e0bdc7b"), by: "Jo Sorgenfri", link: "https://unsplash.com/photos/LgosQ5i-BXM" },
];
const WALL_CHOICES = [
  { id: "daily", name: "每日輪替冰山" },
  ...WALLPAPERS,
  { id: "none", name: "流動光暈（無照片）" },
];

const SECTIONS = [
  ["quote", "每日一句"], ["weather", "天氣"], ["markets", "市場卡片"], ["todo", "代辦事項"], ["project", "店語副業"], ["diary", "日記"],
  ["hustle", "副業發想"], ["learn", "每日學習"], ["idea", "今日想法"], ["news", "國際新聞"],
];

const DEFAULTS = { theme: "auto", blur: 22, radius: 22, motion: true, hidden: [], wall: "daily", layout: "auto" };
let a = { ...DEFAULTS, ...lsGet(KEY, {}) };

function apply() {
  root.dataset.theme = a.theme;
  root.style.setProperty("--blur", `${a.blur}px`);
  root.style.setProperty("--radius", `${a.radius}px`);
  if (a.motion) delete root.dataset.motion; else root.dataset.motion = "off";
  root.dataset.hidden = a.hidden.join(" ");
  root.dataset.layout = a.layout;
  applyWall();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim() || "#0b1026";
  lsSet(KEY, a);
}

function currentWall() {
  if (a.wall === "none") return null;
  if (a.wall === "daily") {
    const day = Math.floor((Date.now() + 8 * 3600e3) / 86400e3); // 台北日期
    return WALLPAPERS[day % WALLPAPERS.length];
  }
  return WALLPAPERS.find((w) => w.id === a.wall) || WALLPAPERS[0];
}

function applyWall() {
  const w = currentWall(), wall = document.getElementById("wall"), credit = document.getElementById("credit");
  root.dataset.wall = w ? "on" : "off";
  if (wall) wall.style.backgroundImage = w ? `url("${w.url}")` : "none";
  if (credit) {
    credit.textContent = w ? `📷 ${w.name}・${w.by} / Unsplash` : "";
    credit.href = w ? `${w.link}?utm_source=life_dashboard&utm_medium=referral` : "#";
  }
}

function swatch(t) {
  const [c1, c2, c3] = t.colors;
  return `background:radial-gradient(circle at 20% 30%,${c1} 0 30%,transparent 55%),radial-gradient(circle at 80% 70%,${c2} 0 28%,transparent 55%),radial-gradient(circle at 55% 10%,${c3} 0 20%,transparent 45%),${t.bg}`;
}

function render() {
  $("themeGrid").innerHTML = THEMES.map((t) =>
    `<button type="button" class="theme-opt ${t.id === a.theme ? "active" : ""}" data-t="${t.id}">
      <div class="sw" style="${swatch(t)}"><i></i></div><span>${t.name}</span></button>`).join("");
  $("blurRange").value = a.blur; $("blurVal").textContent = `${a.blur}px`;
  $("radiusRange").value = a.radius; $("radiusVal").textContent = `${a.radius}px`;
  $("motionToggle").checked = a.motion;
  $("wallGrid").innerHTML = WALL_CHOICES.map((w) => {
    const bg = w.url ? `background:url('${w.url.replace("w=2400", "w=400")}')` : w.id === "daily" ? `background:url('${WALLPAPERS[0].url.replace("w=2400", "w=400")}')` : swatch(THEMES[1]);
    return `<button type="button" class="theme-opt ${w.id === a.wall ? "active" : ""}" data-w="${w.id}">
      <div class="sw" style="${bg}"></div><span>${w.name}</span></button>`;
  }).join("");
  $("layoutChips").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.l === a.layout));
  $("sectionToggles").innerHTML = SECTIONS.map(([id, name]) =>
    `<div class="toggle-row">${name}<input type="checkbox" data-sec="${id}" ${a.hidden.includes(id) ? "" : "checked"}></div>`).join("");
}

// 其他裝置同步過來時重新套用
export function reloadAppearance() {
  a = { ...DEFAULTS, ...lsGet(KEY, {}) };
  apply();
  if ($("appearance").open) render();
}

export function initAppearance() {
  apply();
  const dlg = $("appearance");
  $("themeBtn").onclick = () => { render(); dlg.showModal(); };
  $("themeGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    a.theme = b.dataset.t; apply(); render();
  });
  $("wallGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-w]"); if (!b) return;
    a.wall = b.dataset.w; apply(); render();
  });
  $("layoutChips").addEventListener("click", (e) => {
    const l = e.target.dataset?.l; if (!l) return;
    a.layout = l; apply(); render();
  });
  $("blurRange").oninput = (e) => { a.blur = +e.target.value; $("blurVal").textContent = `${a.blur}px`; apply(); };
  $("radiusRange").oninput = (e) => { a.radius = +e.target.value; $("radiusVal").textContent = `${a.radius}px`; apply(); };
  $("motionToggle").onchange = (e) => { a.motion = e.target.checked; apply(); };
  $("sectionToggles").addEventListener("change", (e) => {
    const id = e.target.dataset.sec; if (!id) return;
    a.hidden = e.target.checked ? a.hidden.filter((x) => x !== id) : [...a.hidden, id];
    apply();
  });
  $("appearanceReset").onclick = () => { a = { ...DEFAULTS }; apply(); render(); };
}
