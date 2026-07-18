# Roadmap

## Phase 0：規劃

Status：目前階段。

Deliverables：

- 產品願景。
- MVP 需求。
- 知識圖譜模型。
- 初始架構。
- AI workflow 定義。
- 整合策略。

## Phase 1：本機 MCP Prototype

Goal：

透過本機 MCP server 證明產品主流程。

Scope：

- 暴露 project 和 idea creation 的 MCP tools。
- 採用 DDD / ports & adapters，讓 core domain 不依賴外部介面。
- 生成 Product Brief。
- 生成 graph nodes 和 graph edges。
- 暴露 graph resources。
- 生成 local tickets。
- 生成 implementation brief。

Exit criteria：

- 可以從 MCP client 跑完一條 idea-to-ticket workflow，而且不依賴外部整合。

## Phase 2：真實儲存

Goal：

保存 canonical project、brief、graph 和 ticket data。

Scope：

- SQLite schema for local MCP usage。
- Repository layer，之後可以支援 Postgres。
- Graph mutation tools。
- Ticket mutation tools。
- AI output 的 draft / approved state。

Exit criteria：

- 使用者離開再回到 project 時，不會遺失 graph context。

## Phase 3：Plane Integration

Goal：

支援 open-source PM tool 作為第一個外部 adapter。

Scope：

- 建立 Plane adapter port。
- 匯出 approved tickets 到 Plane work items。
- 把 Plane work item status 同步回 graph。
- 在有用時連到 modules 或 cycles。

Exit criteria：

- Product graph 可以驅動 Plane 中的 work creation。

## Phase 4：GitHub Integration

Goal：

把 planning output 連到工程 workflow。

Scope：

- 匯出 ticket 到 GitHub Issue。
- 把 issue URL 連到 graph。
- 手動或透過 webhook 把 PR 連到 ticket。
- 把 changed files 存成 graph nodes。

Exit criteria：

- 一張 ticket 可以追溯到 issue、PR 和 changed files。

## Phase 5：AI Implementation Loop

Goal：

讓 AI agents 可以根據 ticket context 實作。

Scope：

- 生成 implementation brief。
- 把 graph context 餵給 coding agent。
- 捕捉 branch、PR、test result 和 summary。
- 實作後更新 graph。

Exit criteria：

- 一張小 ticket 可以從 graph 走到 PR，且保持 traceability。

## Phase 6：Optional UI

Goal：

在 MCP workflow 被證明有用後，再加入視覺化管理層。

Scope：

- Project dashboard。
- Product Brief editor。
- Graph visualization。
- Ticket board。
- Integration settings。

Exit criteria：

- UI 可以 inspect 和 manage 透過 MCP server 建立的資料。
