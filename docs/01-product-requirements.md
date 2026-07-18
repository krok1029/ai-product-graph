# 產品需求

## 目標使用者

初期目標使用者：

- 有很多早期想法的 solo builder。
- 想把想法快速做成 MVP 的 indie hacker。
- 想保留產品上下文的小型產品團隊。
- 使用 AI coding agent、但需要更高品質 tickets 的工程師。

次要使用者：

- Product manager。
- 技術型創辦人。
- Design partner。
- 接案或顧問團隊。

## 核心 Jobs To Be Done

### JTBD 1：釐清模糊想法

當我有一個粗略產品想法時，我希望 AI 可以提出好問題並整理答案，讓我知道自己到底要做什麼。

### JTBD 2：把產品思考轉成 tickets

當我有產品方向時，我希望 AI 可以拆成 epics、features 和 tickets，讓我不用手動從零開始寫每張 issue。

### JTBD 3：保存產品理由

當開始實作時，我希望每張 ticket 都能連回它背後的 goal 和 user pain，讓未來比較容易理解當初為什麼做。

### JTBD 4：給 AI agent 更好的上下文

當 AI agent 要實作 ticket 時，我希望它能拿到相關產品上下文、acceptance criteria、程式碼參考和限制，讓輸出品質更穩定。

## MVP 功能

- 建立 project。
- 新增 idea。
- AI 產生釐清問題。
- 生成 Product Brief。
- 生成知識圖譜。
- 透過 MCP resources 讀取 brief、graph、tickets 和 trace。
- 透過 MCP tools 修改 projects、ideas、graph nodes 和 tickets。
- 透過 MCP prompts 提供可重複使用的產品規劃工作流。
- 生成 tickets。
- 讀取 ticket detail。
- 產生 AI implementation handoff 文件。
- 本機流程穩定後，再選擇性匯出到 GitHub Issues 或 Plane。

## MVP 非目標

- 即時多人協作。
- 複雜權限系統。
- 付費機制。
- 完整 sprint planning。
- 人力負載管理。
- 工時追蹤。
- 原生 code editing UI。
- GitHub、Plane 或 Linear 的完整替代品。
- 完整 Web UI。
- 互動式圖譜視覺化。

## 產品限制

- 第一版應該對單人使用者就有價值。
- 資料模型要保留未來多人協作的可能性。
- 圖譜模型要足夠簡單，先能存在 SQLite，之後可遷移到 Postgres。
- 外部整合在第一版應該是可選的。
- AI 生成的 Product Brief、graph nodes、graph edges 和 tickets 先建立為 draft，使用者 approve 後才成為 canonical data。
- MCP tools 應該窄、可預期，適合讓 agent 安全呼叫。
