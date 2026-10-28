// GitHub REST helpers for the life-tasks repo (todos.json + ai-task issues).
import { settings } from "./store.js";

const API = "https://api.github.com";

function headers() {
  const h = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (settings.githubToken) h.Authorization = `Bearer ${settings.githubToken}`;
  return h;
}

const repoPath = () => `${API}/repos/${settings.owner}/${settings.tasksRepo}`;

// UTF-8 safe base64
const b64encode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

async function loadJson(path) {
  if (settings.githubToken) {
    const r = await fetch(`${repoPath()}/contents/${path}?ref=main`, { headers: headers(), cache: "no-store" });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = await r.json();
    return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
  }
  // 沒有 token：只能讀公開 repo
  const r = await fetch(`https://raw.githubusercontent.com/${settings.owner}/${settings.tasksRepo}/main/${path}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`讀取失敗 ${r.status}（私人 repo 需要在設定填入 GitHub Token）`);
  return { data: await r.json(), sha: null };
}

export const loadTodos = () => loadJson("todos.json");
export const loadProjects = async () => (await loadJson("projects.json")).data;

// Read-modify-write with one retry on sha conflict (another AI may have pushed meanwhile).
export async function mutateTodos(mutator, message) {
  if (!settings.githubToken) throw new Error("需要在設定填入 GitHub Token 才能修改代辦");
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, sha } = await loadTodos();
    const result = mutator(data);
    data.updated = new Date().toISOString();
    const r = await fetch(`${repoPath()}/contents/todos.json`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        message,
        content: b64encode(JSON.stringify(data, null, 2) + "\n"),
        sha,
        branch: "main",
      }),
    });
    if (r.ok) return { data, result };
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  }
  throw new Error("代辦檔案同時被修改，請重試");
}

export function newTodo({ title, due = null, priority = "medium", tags = [], notes = "", project }, source = "dashboard") {
  return {
    id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title, done: false, due, priority, tags, notes, source,
    ...(project ? { project } : {}),
    created: new Date().toISOString(),
  };
}

export async function addTodo(fields, source) {
  const item = newTodo(fields, source);
  await mutateTodos((d) => { d.items.unshift(item); }, `todo: add "${item.title}" (${source})`);
  return item;
}

export async function setTodoDone(id, done, source = "dashboard") {
  const { result } = await mutateTodos((d) => {
    const t = d.items.find((x) => x.id === id);
    if (!t) throw new Error(`找不到代辦 ${id}`);
    t.done = done;
    t.completed = done ? new Date().toISOString() : null;
    return t;
  }, `todo: ${done ? "complete" : "reopen"} ${id} (${source})`);
  return result;
}

export async function createAiTask({ title, body, labels = [] }) {
  if (!settings.githubToken) throw new Error("需要 GitHub Token 才能建立任務");
  const r = await fetch(`${repoPath()}/issues`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ title, body, labels: ["ai-task", ...labels] }),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { number: j.number, url: j.html_url };
}

export async function listAiTasks(state = "open", label = "") {
  const labels = ["ai-task", label].filter(Boolean).join(",");
  const r = await fetch(`${repoPath()}/issues?labels=${encodeURIComponent(labels)}&state=${state}&per_page=30`, { headers: headers() });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return (await r.json()).map((i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, updated: i.updated_at, labels: i.labels.map((l) => l.name) }));
}
