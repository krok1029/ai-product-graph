# 系統架構

## 架構原則

先做 MCP server，讓 AI agent 可以結構化存取產品規劃、知識圖譜、ticket 和 implementation context。

架構採用 DDD 與 ports & adapters。核心 domain 不依賴 MCP、Plane、GitHub 或任何外部介面；MCP server 和未來外部整合都只是 adapters。

## 建議 MVP Stack

建議起始技術：

- Runtime：Node.js + TypeScript。
- TypeScript toolchain：優先嘗試 TypeScript 7 / `tsgo`，同時保留 TypeScript 6 fallback。
- Protocol surface：MCP server。
- Storage：本機 SQLite；目前不安排 Postgres 遷移。
- AI orchestration：三個 skills 編排 client agent；MCP 提供 resources、structured context、驗證與保存；六個舊 prompts 僅供 full 相容模式。
- 範圍：本機、單人使用；依 2026-09-28 使用者決策移除 Hosted MCP 與多人版本，不安排其帳號／權限系統。外部 provider 憑證仍由各 adapter 管理。

## High-Level Components

```text
MCP Server
  -> Tools
  -> Resources
  -> Legacy prompts (full only)

Core Domain
  -> Projects
  -> Ideas
  -> Product Briefs
  -> Milestones / Specs
  -> Graph Nodes
  -> Graph Edges
  -> Tickets
  -> Implementation Briefs
  -> Domain Services
  -> Repository Interfaces

Application Layer
  -> Use Cases
  -> DTOs
  -> Draft / Approval Workflow
  -> Audit Log Writer
  -> Durable Sync Intent / Outbox Writer

AI Orchestration
  -> Planning / implementation / acceptance skills
  -> Structured context resources
  -> Tool workflows
  -> Client agent performs generation

Data Layer
  -> Local SQLite
  -> product_briefs store structured JSON as canonical
  -> graph_nodes / graph_edges

Integrations
  -> MCP adapter first
  -> Plane adapter (partially delivered; follow-ups deferred)
  -> Agent uses gh for GitHub; existing MCP evidence/result workflow
  -> Coding agent handoff adapter
  -> Post-commit provider execution (explicit CLI; mapped updates pending)
```

GitHub 操作由 client agent 使用 `gh` 執行，MCP 保存符合既有契約的 evidence 與 Result 引用；目前不新增 GitHub adapter 或同步程序。既有 External Work Item 模型保留，不由此推定 agent 的每次 `gh` 操作均受 outbox／mapping 自動管理。

## 建置順序

本機 MCP、SQLite 與規劃到驗收已落地。後續依 [roadmap](08-roadmap.md) 統一基線、驗證持續開發與接手、改善實際查詢缺口，再按需求恢復選配整合；不以 provider 完成度安排核心流程。

## 需要保留的架構決策

- MVP 階段，PM integrations 保持外部整合。
- Canonical product knowledge 存在本地。
- 外部 tickets 和 PRs 是 linked artifacts。
- Product Brief／Ticket 的新版本保留 draft／approval；Milestone／Spec 在已授權規劃範圍內自動保存圖譜，不把 applied 偽裝成人類核准。Result Acceptance 仍為獨立決策。
- Graph edits 使用簡單 audit log，不做完整 event sourcing。
- Domain model 不依賴外部整合；外部介面透過 ports & adapters 接入。
- Approval transaction 只原子保存 domain state 與 durable Sync Intents，不在 transaction 內呼叫外部 API；integration processor 在 commit 後執行並可於服務重啟後恢復。
- 第一版 implementation 只產生 handoff，不內建執行 coding agent。
- 第一版 MCP transport 使用 stdio。
- Primary target MCP client 是 Codex，但保持標準 MCP 相容。
- TypeScript 7 是 Go-based native toolchain，第一版可以試用其 faster typechecking；若 MCP SDK、SQLite driver、test runner 或 build tooling 相容性不足，回退 TypeScript 6。
- 不需要 Neo4j，除非 graph query 複雜度證明需要。
- Embedding / semantic search 第一版只預留，不實作。
- UI 是可選介面，不是第一產品表面。

## Durable Sync Attempt claim boundary

`SyncAttemptClaims` 與 `ApplicationPorts.syncClaims` 提供 Plane manual create request 的 claim、invocation 記錄與 failure lifecycle。SQLite 專用 coordination history 以唯一 token、lease 與原子寫入協調多個 workers，意外中斷後可從 durable attempts 恢復。Claim token 只能 fence 本機 transaction，不能保證 provider exactly-once；可能已送出的 request 必須先 reconciliation，不能直接重送。

Provider invocation 不在 SQLite transaction 內。Processor 的 success port 必須在包含 External Work Item、mapping、snapshot、trace 與 audit 的同一 transaction 執行。此階段不新增可偽造 success 的 MCP mutation，也不自動啟動 processor 或 live Plane adapter。詳見 [ADR 0037](adr/0037-durable-sync-claims-and-reconciliation.md)。
