# ADR 0007：AI 生成內容採用 Draft First

## Status

Accepted

## Context

AI Product Graph 會透過 AI 生成 Product Brief、graph proposed changes、tickets 和 implementation brief。

這些生成內容會直接影響 project knowledge graph 和後續 coding agent 的實作上下文。如果錯誤內容直接寫入 canonical data，會污染 graph，讓 tickets 和後續實作建立在錯誤假設上。

## Options Considered

### A：自動寫入 Canonical Data

優點：

- 流程最快。
- Agent 操作步驟少。
- Demo 看起來更順。

缺點：

- AI 錯誤會直接污染 Product Brief、graph 或 tickets。
- 之後需要額外清理資料。
- 使用者較難知道哪些內容是確認過的。

### B：全部先建立 Draft，Approve 後才成為 Canonical

優點：

- 使用者可以 review AI output。
- Canonical graph 品質較穩。
- 可清楚區分 generated、reviewed、approved 狀態。
- 較適合產品規劃和 ticket-to-code 這種需要上下文正確性的流程。

缺點：

- 每次 generation 都多一個 review / approve step。
- MCP tools 需要處理 draft lifecycle。
- 初期資料模型會稍微多一些狀態欄位。

### C：分級處理

優點：

- 低風險內容可快速寫入，高風險內容先 draft。
- 長期體驗可能較流暢。

缺點：

- 第一版規則較複雜。
- 需要定義哪些內容算高風險。
- 容易讓 agent 行為不一致。

## Decision

第一版採用選項 B：AI 生成內容一律 draft first。

Product Brief Version、Graph Draft Batch、Ticket revisions 和 Implementation Brief 必須先建立為 draft。Graph proposed changes 在 batch 核准前不是 canonical GraphNodes 或 GraphEdges；使用者 approve 適用的 review unit 後，內容才可以成為 canonical data。

## Rationale

- 這個產品的核心價值是可信的 project context，不是單次生成速度。
- Draft first 可以避免 AI hallucination 或誤解直接污染知識圖譜。
- 後續 coding agent 會依賴這些上下文，因此進入 implementation 前必須有 review gate。

## Trade-offs

- 接受 MVP workflow 多一個 approve step。
- 接受 schema 需要支援 `status`、`approved_at`、`approved_by` 等欄位。
- 先不做複雜風險分級，避免第一版規則過度設計。

## Consequences

- MCP tools 應區分 `create_draft_*`、`approve_*` 或在 input 中明確標示 draft 行為；graph 必須以 batch 為 review unit。
- Resources 應能顯示 draft 和 canonical data 的差異。
- Ticket 只有 approved 後才可外部匯出或進入 implementation handoff。
