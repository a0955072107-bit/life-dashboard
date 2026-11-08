# 清醒行動派 IG 機器人

跟店語文案用同一套機器人，用 GitHub Actions 每 30 分鐘自動做三件事，不用開電腦、不用另外付錢：

| 做什麼 | 怎麼運作 |
|---|---|
| **排程發文** | `qingxing/instagram/posts/` 裡時間到了的貼文 → 自動發到 IG（單張或輪播），預設每晚 20:00 |
| **回留言** | 留言「清醒」→ 公開回一句＋私訊 7 天清醒行動表；問電子書 → 私訊連結；Day 17 的 1／2／3、Day 11 的「打卡」也會自動回 |
| **回私訊** | 第一次來訊 → 歡迎訊息；問「清醒」「電子書」「陪跑」→ 自動回；其他留給你 |

機器人只用 IG 官方 API，不會自動追蹤、按讚或刷互動。**抖音沒有開放給個人自動發文**，抖音版要自己上傳。

---

## 一次性設定（照順序，一步做完再做下一步）

### 第 0 步：準備 IG 帳號
1. 用 qingxing.action@gmail.com 註冊 IG，帳號 `qingxing.action`
2. IG → 設定 → 帳號類型和工具 → **切換為專業帳號** → 選「創作者」→ 類別選「個人部落格」或「教育」

### 第 1 步：在 Meta 建立應用程式
1. 電腦打開 <https://developers.facebook.com/apps> → 用 Facebook 登入 → **建立應用程式**
2. 用途選 **「管理 Instagram 上的訊息和內容」** → 名稱填 `Qingxing Bot` → 建立
3. 發文和留言不用送審、不用切成「上線」模式

### 第 2 步：拿到 IG 權杖
1. 應用程式左邊選 **Instagram → 使用 Instagram 登入的 API 設定**
2. **產生存取權杖** → **新增帳號** → 登入 `qingxing.action` → 全部允許
3. 按 **產生權杖**，複製那一長串（只會顯示一次）
4. 手機 IG → 設定 → **訊息和通話 → 已連結的工具 → 允許存取訊息** 打開

### 第 3 步：把權杖存到 GitHub
`life-dashboard` repo → **Settings → Secrets and variables → Actions → New repository secret**
Name：`QX_IG_ACCESS_TOKEN`，Secret：貼上第 2 步的權杖

> 2026-11 實際接法：Meta 新版頁面叫「API setup with Unified login」，要先建「商家資產管理組合」、建一個設定（勾 instagram_business_* 權限、重新導向網址隨便填一個 https 網址）、把帳號加成 Instagram 測試人員並在 https://www.instagram.com/accounts/manage_access/ 接受，再按「產生權杖」。拿到的是 `EAA…` 開頭的系統用戶權杖，**永不到期**，機器人會自動改走 graph.facebook.com，並用 workflow 裡的 IG 帳號 ID（17841479844842573）。拿到這種權杖的話第 4 步可以跳過。

### 第 4 步：讓權杖自動續期（舊版 IGAA… 權杖才需要）
1. 打開 <https://github.com/settings/personal-access-tokens/new>
2. Token name：`qingxing-ig`；Expiration：最長；Repository access：**Only select repositories** → 選 `life-dashboard`
3. Permissions → Repository permissions → **Secrets** 改成 **Read and write** → **Generate token** → 複製
4. 照第 3 步再新增 secret：Name `GH_PAT`

### 第 5 步：試跑
**Actions → 清醒行動派 IG 機器人 → Run workflow**（「試跑」保持打勾）。約 1 分鐘後看紀錄出現 `IG 帳號：@qingxing.action` 就是接好了。

### 第 6 步：正式開啟
**Settings → Secrets and variables → Actions → Variables → New repository variable**
Name：`QX_IG_BOT_ENABLED`，Value：`true`。要暫停改成 `false`。

---

## 平常怎麼用

- **貼文內容**在 `qingxing/scripts/posts-data.mjs`，改完執行 `node qingxing/scripts/build-ig.mjs` 重新產生圖片（`qingxing/ig/`）和貼文檔（`qingxing/instagram/posts/`）。跟 Claude 說「幫我改 Day 8 的文案」也可以。
- **草稿**：`status: draft` 不會發。Day 10（親身故事）、Day 20（內頁截圖、讀者回饋）、Day 30（數據）先設成草稿，補好再改成 `ready`。
- **短影音日**（Day 2、5、9…）：自動發字幕卡輪播。想發口播 Reels，自己錄好上傳就好，記得把那天的貼文改成 `draft` 避免重複。
- 時間到後約 30 分鐘內發出；超過 48 小時沒發的不會補發。
- **改自動回覆**：改 `qingxing/instagram/replies.json`（規則寫法同店語文案的 `instagram/README.md`）。

## 費用與限制
- 這個 repo 是公開的，GitHub Actions 不收費；貼文圖片和文案在發出前也是公開的
- 一個 IG 帳號每 24 小時最多 50 篇 API 發文

## 出問題時
GitHub 會寄信通知執行失敗。打開 **Actions** 點那次執行，把黃色或紅色訊息整段複製給 Claude。
