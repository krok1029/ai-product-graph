# 資訊架構

## 主要物件

- Workspace
- Project
- Product Brief
- Graph Node
- Graph Edge
- Ticket
- Integration
- Repository
- Pull Request
- Decision
- Feedback

## 主要 Agent 介面

第一版是 MCP-first，所以資訊架構要先以 agent 可讀、可呼叫的能力為中心，而不是先設計 UI 畫面。

### MCP Tools

由模型控制的 actions：

- 建立 project。
- 新增 idea。
- 產生釐清問題。
- 儲存 Product Brief。
- 生成 graph nodes 和 graph edges。
- 查詢 graph context。
- 生成 tickets。
- 建立 implementation brief。

### MCP Resources

由應用提供的 context：

- Project overview。
- Product Brief。
- Knowledge graph。
- Ticket list。
- Ticket context。
- Node trace。

### MCP Prompts

由使用者觸發的工作流：

- Product Brief generation。
- Graph extraction。
- Ticket generation。
- Implementation handoff。
- Ticket quality review。

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

MVP 可以先把它做成 markdown implementation brief，不需要完整 live agent console。

## 導航

未來 UI 的第一層導航：

- Home
- Ideas
- Graph
- Tickets
- Integrations
- Settings
