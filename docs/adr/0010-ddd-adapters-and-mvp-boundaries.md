# ADR 0010：DDD、Adapters 與 MVP 邊界

## Status

Accepted

## Context

AI Product Graph 需要同時支援 MCP client、Plane、GitHub、coding agent handoff，未來也可能加入 UI、Notion、Slack 或其他外部介面。

如果一開始讓 domain model 直接依賴特定外部工具，後續整合會變難，也會讓核心產品邏輯和 adapter 細節糾纏。

本 ADR 彙整 Q7-Q15 的批次決策。

## Decisions

### DDD / Ports & Adapters

採用 DDD 與 ports & adapters。

- Core domain 不依賴 MCP、Plane、GitHub 或 UI。
- Application layer 定義 use cases 和 ports。
- MCP、Plane、GitHub、Markdown export、未來 UI 都是 adapters。

### Repository Context

第一版 MCP server 不直接掃描 local repository。

它只接受使用者或 client agent 提供的 repo summary、file list、module notes 或相關 code context。

### Coding Agent Execution

第一版不內建執行 coding agent。

MCP server 只產生 implementation brief，交給 Codex 或其他 coding agent 執行。

### External Integration Priority

MVP 不做外部 PM / issue integration。

架構先保留多 adapter 能力。MVP core 完成後，第一個外部 adapter 優先做 Plane，GitHub Issues / PR adapter 排在 Plane 之後。

### MCP Tool Granularity

採用混合策略。

- MVP 先做少量粗粒度 workflow tools。
- 同時保留必要 read tools。
- 細粒度 mutation tools 視實作需要逐步加入。

### MCP Transport

第一版使用 stdio local MCP server。

HTTP-based MCP server 延後到 hosted / multi-user 需求明確後再做。

### Human Review

第一版 human review 放在：

- MCP client 對話確認。
- Markdown draft export。

不做 UI review。

### ID Strategy

主要 entities 使用 ULID 作為穩定 ID，並保留 display slug 供人類閱讀、搜尋和外部匯出。

### Embedding / Semantic Search

第一版只預留 embedding / semantic search extension point，不實作 embeddings。

### Primary MCP Client

第一版以 Codex 為 primary target MCP client，同時保持標準 MCP 相容。

## Rationale

- DDD / ports & adapters 可以讓核心產品能力獨立於外部工具。
- Plane-first adapter 符合開源 PM 工具方向，但不應阻塞 MCP MVP。
- Handoff-first coding agent 流程可以先證明 ticket-to-code context 是否有價值。
- stdio MCP server 最適合本機第一版。
- ULID + slug 兼顧穩定同步和人類可讀。
- Embeddings 延後可以避免第一版過度複雜。

## Trade-offs

- Core / application / adapter 分層會比單檔 prototype 多一些結構。
- 不直接掃 repo 會讓 implementation brief 的 code context 較弱。
- 不內建 coding agent execution 代表第一版不是完整自動閉環。
- 不做外部整合會讓 MVP 更偏 agent workflow，而不是 PM workflow。

## Consequences

- 專案 scaffold 應分成 domain、application、adapters、infrastructure。
- Plane 和 GitHub 不應直接出現在 domain types 裡。
- MCP tools 應呼叫 application use cases，不直接操作 SQLite。
- Implementation brief schema 應允許輸入 repo summary / file list。
- Markdown draft export 應成為 review workflow 的一部分。
