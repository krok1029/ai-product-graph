# 資訊架構

## 主要物件

- Project 與 Repository：規劃工作區及其實作目標，不以 Workspace 另建平行概念。
- Idea、Product Brief／Version、Milestone、Spec、Ticket／Revision。
- Graph Node／Edge／Revision：規劃關係與歷史。
- Implementation Target、Repository Context、Implementation Brief。
- Observed Evidence、Implementation Result、Result Acceptance／Revocation、Decision。
- 選配外部整合：External Container、External Work Item、mapping、snapshot、drift 與 sync 紀錄。

名稱以 [CONTEXT](../CONTEXT.md) 為準。Milestone／Spec 是正式 graph nodes，不另建一套規劃資料來源。

## 主要 Agent 介面

三個 skills 編排規劃、實作與驗收；agent 生成內容，MCP 驗證結構、版本與交易並保存資料。

### MCP Tools

- 保存 Project、Repository、Idea 與 Product Brief drafts／approvals。
- 保存 Milestone／Spec 並自動同步圖譜。
- 保存與核准源自 Spec 的 Ticket Revisions。
- 查詢 graph／work context，包含來源影響、交付、依賴與待接受結果。
- 保存實作計畫、檢查 handoff、提交 evidence／Result、記錄 Acceptance／Revocation。
- 依需要匯出 Markdown，不要求以文件搬運每一步資料。

### MCP Resources

提供 Project、Product Brief、graph、Ticket context 與 node trace 等正式資料入口。進度回答使用 `get_graph_context.delivery` 與 `get_work_context` 的診斷；不假設每個 resource 都具有相同的新欄位。

### Profiles 與 Skills

Core 提供 23 個 tools 與本機 resources，無 MCP prompts。規劃／實作／驗收 skills 是預設流程入口；full 提供 44 個 tools、六個舊 prompts 與外部工具，用於相容與選配整合。切換 profile 不會自動遷移 Project 或啟動同步。

詳細介面見 [精簡工作流](22-skill-led-workflows.md) 與 [階層規劃](23-planning-hierarchy.md)。

## 未來 UI 畫面

這些畫面之後會有用，但不應該是 MVP 的必要條件。

### Project Home

顯示 project 狀態、最近 graph 變更、open tickets 和下一步建議。

### Idea Workspace

專注於把模糊想法轉成 Product Brief 的工作區。

主要區塊：

- Idea input。
- AI conversation。
- Product Brief preview。
- Open questions。

### Graph View

互動式圖譜探索畫面。

常見操作：

- 依 node type 過濾。
- 點擊 node 查看細節。
- 展開相關 nodes。
- 從 goal 追溯到 ticket 或 PR。
- 修改 node title 和 description。

### Ticket Board

以狀態、feature area 或 graph node 分組的 ticket list。

Ticket detail 應顯示：

- Scope。
- Acceptance criteria。
- Non-goals。
- Related graph nodes。
- Implementation context。
- External issue link。
- Pull request link。

### Implementation View

顯示 ticket 到 coding agent 的 handoff。

目前由對話與結構化 Implementation Brief／Result 提供上下文，Markdown 只在需要時匯出，不需要完整 live agent console。

## 導航

未來 UI 的第一層導航：

- Home
- Ideas
- Graph
- Tickets
- Integrations
- Settings
