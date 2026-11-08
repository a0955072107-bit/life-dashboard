# 清醒行動派 Threads 機器人

每天 4 則純文字（08:30 開場一句、12:30 做法、18:00 金句、21:30 問句導回 IG），內容是從 IG 貼文自動拆出來的，用 GitHub Actions 每 30 分鐘檢查一次、時間到就發。Threads 是現在台灣 18–35 歲最容易被推薦的平台，而且跟 IG 同一個帳號。

| 檔案 | 用途 |
|---|---|
| `posts.json` | 全部 Threads 文字（由 `node qingxing/scripts/build-threads.mjs` 從 `posts-data.mjs` 產生，重跑會覆蓋） |
| `bot.mjs` | 機器人本體：發時間到的文字，用最近 50 則比對避免重發 |
| `../../.github/workflows/qingxing-threads-bot.yml` | 每小時第 17、47 分（UTC）跑一次 |
| `../../.github/workflows/qingxing-threads-token-refresh.yml` | 每週一自動續期權杖 |

## 一次性設定

### 第 0 步：開 Threads 帳號
手機裝 **Threads** App，用 IG 帳號 `qingxing.action` 登入一次。Threads 帳號就開好了（名稱、頭像跟 IG 同步）。

### 第 1 步：在 Meta 應用程式加上 Threads
1. <https://developers.facebook.com/apps> → 打開 IG 機器人用的那個應用程式（`Qingxing Bot`）
2. 左邊 **使用案例 → 新增使用案例**（或「新增產品」）→ 選 **「存取 Threads API」** → 設定
3. 到 Threads 的設定頁，**權限** 勾 `threads_basic` 和 `threads_content_publish`（只要這兩個）
4. **角色 → 新增 Threads 測試人員** → 填 `qingxing.action` → 送出邀請
5. 手機 Threads App → 設定 → **帳號 → 網站權限 → 邀請** → 接受

### 第 2 步：拿到權杖
1. 回到應用程式的 Threads 設定頁 → **產生存取權杖**（或「Threads 測試人員」旁邊的產生權杖）→ 用 `qingxing.action` 登入 → 全部允許
2. 複製那一長串（只會顯示一次）。這是 60 天的長期權杖；要是拿到的是 1 小時短期權杖，先跟 Claude 說，用下面的指令換成長期的：
   `curl -s "https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=<應用程式密鑰>&access_token=<短期權杖>"`

### 第 3 步：存到 GitHub
`life-dashboard` repo → **Settings → Secrets and variables → Actions → New repository secret**
Name：`QX_THREADS_ACCESS_TOKEN`，Secret：貼上權杖。（續期用的 `GH_PAT` 跟 IG 共用，IG 那邊設過就好。）

### 第 4 步：試跑
**Actions → 清醒行動派 Threads 機器人 → Run workflow**（「試跑」保持打勾）。紀錄出現 `Threads 帳號：@qingxing.action` 就是接好了。

### 第 5 步：正式開啟
**Settings → Secrets and variables → Actions → Variables → New repository variable**
Name：`QX_THREADS_BOT_ENABLED`，Value：`true`。要暫停改成 `false`。

## 平常怎麼用
- 改文字：改 `qingxing/scripts/posts-data.mjs`（IG 文案）後重跑 `node qingxing/scripts/build-threads.mjs`；文案結尾沒問句的那幾天，Threads 用的問句寫在 build-threads.mjs 的 `QUESTIONS`。
- 想單獨加一則：直接在 `posts.json` 加一筆（`id`、`publish_at` 要帶 `+08:00`、`status: ready`、`text`）。
- 草稿貼文（IG 那篇 `draft: true`）拆出來的也是 draft，不會發。
- 超過 6 小時沒發出的不補發（一天四則，補舊的沒意義）。

## 限制
- Threads API 一天最多 250 則，文字 500 字。
- 機器人只發文，不會自動回覆或追蹤；Threads 的留言要自己回。
