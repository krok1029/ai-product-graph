# Implementation Plan

## 目標

第一階段目標是建立一個本機 stdio MCP server，讓 Codex 或其他標準 MCP client 可以透過 tools、resources、prompts 操作 AI Product Graph 的核心流程。

第一階段不做：

- Web UI。
- HTTP MCP server。
- Server-side LLM calls。
- Plane / GitHub 外部整合。
- 直接掃描 local repository。
- Embeddings。

## 技術決策摘要

- Runtime：Node.js + TypeScript。
- TypeScript toolchain：優先試用 TypeScript 7 / `tsgo`；若 dependency tooling 或 compiler API 相容性不足，保留 TypeScript 6 fallback。
- Architecture：DDD + ports & adapters。
- MCP transport：stdio。
- Storage：SQLite。
- LLM generation：由 MCP client agent 執行，server 只提供 prompts / context / validation / persistence。
- AI output：draft first，approve 後才 canonical。
- Review：MCP client 對話確認 + Markdown draft export。
- IDs：ULID + display slug。
- Graph edits：簡單 audit log。

## 建議專案結構

```text
.
├── docs/
├── src/
│   ├── domain/
│   │   ├── projects/
│   │   ├── ideas/
│   │   ├── product-briefs/
│   │   ├── graph/
│   │   ├── tickets/
│   │   └── implementation-briefs/
│   ├── application/
│   │   ├── use-cases/
│   │   ├── ports/
│   │   └── dtos/
│   ├── adapters/
│   │   ├── mcp/
│   │   ├── markdown/
│   │   └── plane/
│   ├── infrastructure/
│   │   ├── sqlite/
│   │   ├── migrations/
│   │   └── config/
│   └── index.ts
├── data/
│   └── .gitkeep
├── package.json
├── tsconfig.json
└── README.md
```

`plane` adapter 第一階段可以先留資料夾或 interface，不實作 API calls。

## Phase 1 任務拆解

### 1. TypeScript Scaffold

Deliverables：

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- TypeScript 7 / `tsgo` 試用 scripts。
- TypeScript 6 fallback scripts。
- 基本 lint / format 設定，若一開始不想引入太多工具可延後。

驗收條件：

- 可以執行 TypeScript entrypoint。
- 專案 scripts 清楚，例如 `dev`、`build`、`typecheck`。
- `typecheck` 優先使用 TypeScript 7 / `tsgo`；若失敗原因是工具相容性，需能切回 TypeScript 6。

### 2. Domain Models

Deliverables：

- Project entity。
- Idea entity。
- ProductBrief entity。
- GraphNode entity。
- GraphEdge entity。
- Ticket entity。
- ImplementationBrief entity。
- AuditLogEntry entity。

驗收條件：

- Domain models 不 import MCP SDK、SQLite driver、Plane SDK 或 GitHub SDK。
- 主要 entities 使用 ULID。
- 主要 entities 支援 `status`，用於 draft / approved lifecycle。

### 3. Repository Ports

Deliverables：

- `ProjectRepository`
- `IdeaRepository`
- `ProductBriefRepository`
- `GraphRepository`
- `TicketRepository`
- `ImplementationBriefRepository`
- `AuditLogRepository`

驗收條件：

- Application use cases 只依賴 ports，不直接依賴 SQLite。

### 4. SQLite Infrastructure

Deliverables：

- SQLite connection factory。
- Schema initialization。
- Migration runner，第一版可簡單讀取 ordered SQL files。
- SQLite implementations for repository ports。

驗收條件：

- 新環境啟動時可建立 database。
- 重啟 server 後資料仍存在。
- Mutating operations 會寫 audit log。

### 5. Application Use Cases

Deliverables：

- `CreateProject`
- `AddIdea`
- `CreateProductBriefDraft`
- `ApproveProductBrief`
- `CreateGraphDraft`
- `ApproveGraphDraft`
- `CreateTicketDrafts`
- `ApproveTicket`
- `CreateImplementationBriefDraft`
- `ExportMarkdownDraft`

驗收條件：

- Use cases 回傳 structured result summary。
- Draft -> approve lifecycle 清楚。
- Ticket 只有 approved 後才可進入 implementation handoff。

### 6. MCP Adapter

Deliverables：

- stdio MCP server。
- MVP MCP tools。
- MVP MCP resources。
- MVP MCP prompts。

驗收條件：

- Codex 可以啟動 MCP server。
- MCP client 可以建立 project、add idea、建立 draft brief、讀取 graph/tickets context。

### 7. Markdown Adapter

Deliverables：

- Product Brief Markdown renderer。
- Ticket Markdown renderer。
- Implementation Brief Markdown renderer。
- Draft export path 規則。

驗收條件：

- Markdown 由 canonical JSON / structured data render。
- Markdown 不作為 canonical source of truth。

### 8. Minimal Validation

Deliverables：

- Tool input validation。
- Product Brief JSON validation。
- Graph node / edge type validation。
- Ticket acceptance criteria validation。

驗收條件：

- 缺少 required fields 時，MCP tool 回傳清楚錯誤。
- 每張 generated ticket 必須連到至少一個 product goal 或 pain point。

## 第一個 End-to-End Demo

Demo 流程：

```text
1. create_project
2. add_idea
3. 讀取 product-brief prompt
4. client agent 生成 Product Brief JSON
5. create_product_brief_draft
6. approve_product_brief
7. 讀取 extract-graph prompt
8. client agent 生成 graph nodes / edges
9. create_graph_draft
10. approve_graph_draft
11. 讀取 generate-tickets prompt
12. client agent 生成 tickets
13. create_ticket_drafts
14. approve_ticket
15. create_implementation_brief_draft
16. export_markdown_draft
```

## Definition Of Done

Phase 1 完成時應具備：

- 本機 stdio MCP server 可啟動。
- SQLite database 可建立和保存資料。
- 核心 use cases 走 DDD / ports & adapters。
- Product Brief、graph、tickets 都支援 draft first。
- MCP resources 能讀 project context。
- Markdown draft export 可產出 human review 文件。
- 不依賴外部 integrations。
