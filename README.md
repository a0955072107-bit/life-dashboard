# 🌈 生活儀表板

給自己用的玻璃風格生活儀表板，部署在 GitHub Pages。電腦、平板、手機都能用，也可以「加入主畫面」當 App 開。

| 區塊 | 資料來源 | 更新方式 |
|---|---|---|
| 🌤 天氣 | Open-Meteo（免金鑰） | 瀏覽器即時抓 |
| 📈 美股 / 指數 / 黃金 / 匯率（重疊滑動卡片） | Yahoo Finance | GitHub Actions：交易時段每 30 分鐘 |
| 🌍 國際新聞 + 重點摘要 | Google 新聞、BBC、Al Jazeera、NPR RSS（摘要由 Claude 產生） | Actions：每天 06:13、18:17（台北） |
| 💼 副業發想 / 💡 每日想法 / ✨ 每日一句 | Claude 生成；沒設金鑰時從 `scripts/pool.json` 輪播 | Actions：每天 06:13 |
| ✅ 代辦事項 | [`life-tasks`](https://github.com/a0955072107-bit/life-tasks) repo 的 `todos.json` | 即時讀寫 |
| 🤖 AI 助手 | Claude API（聊天、上網搜尋、管代辦、開 AI 任務 issue） | 瀏覽器直接呼叫 |
| 🎨 外觀 | 9 套主題、模糊度、圓角、動畫、區塊顯示開關 | 存在本機 |

## 設定步驟

1. **開啟 GitHub Pages**：Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾選 `/ (root)`。網址會是 `https://a0955072107-bit.github.io/life-dashboard/`。
2. **（建議）設定 Claude 金鑰給自動排程**：Settings → Secrets and variables → Actions → New repository secret，名稱 `ANTHROPIC_API_KEY`。有它才會產生繁中新聞摘要和每天不同的副業/想法；沒有也能運作。
3. **第一次手動跑資料**：Actions → 「更新儀表板資料」→ Run workflow（勾選「重新產生每日內容」）。
4. **在網頁右上角 ⚙ 設定**：
   - **GitHub Token**：到 https://github.com/settings/personal-access-tokens/new 建立 Fine-grained token，Repository access 只選 `life-tasks`，Permissions 給 **Contents: Read and write**、**Issues: Read and write**。
   - **Anthropic API Key**：AI 助手用，到 https://console.anthropic.com 建立。
   - 金鑰只存在該裝置的瀏覽器，不會進 repo。每台裝置（電腦、平板）各自設定一次。

## 自訂

- 想追蹤的股票、指數、新聞來源：改 `config.json`。
- 副業與想法的備用內容：改 `scripts/pool.json`。
- 主題顏色：`assets/style.css` 最上方的 `[data-theme=...]`，以及 `assets/theme.js` 的 `THEMES` 清單。

## 檔案結構

```
index.html            頁面
assets/app.js         主程式（天氣、市場卡片、新聞、每日內容、代辦）
assets/chat.js        AI 助手
assets/github.js      life-tasks 讀寫
assets/theme.js       外觀設定
scripts/*.py          Actions 用的資料抓取腳本
data/*.json           自動產生的資料
```
