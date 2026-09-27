# Implementation Plan

## 目標

第一階段目標是建立一個本機 stdio MCP server，讓 Codex 或其他標準 MCP client 可以透過 tools、resources、prompts 操作 AI Product Graph 的核心流程。

第一階段不做：

- Web UI。
- HTTP MCP server。
- Server-side LLM calls。
- Plane / GitHub 外部 API calls 或 background sync processor。
- 直接掃描 local repository。
- Embeddings。

## 技術決策摘要

- Runtime：Node.js + TypeScript。
- Package manager：`pnpm`。
- TypeScript toolchain：優先試用 TypeScript 7 / `tsgo`；若 dependency tooling 或 compiler API 相容性不足，保留 TypeScript 6 fallback。
- Architecture：DDD + ports & adapters。
- MCP transport：stdio。
- Storage：SQLite，driver 使用 `better-sqlite3`。
- MCP SDK：第一版直接使用官方 `@modelcontextprotocol/sdk`。
- Testing：使用 Vitest。
- LLM generation：由 MCP client agent 執行，server 只提供 prompts / context / validation / persistence。
- AI output：draft first，approve 後才 canonical。
- Review：MCP client 對話確認 + Markdown draft export。
- IDs：ULID + display slug。
- Graph edits：Graph Draft Batch + Graph Revision + audit log。
- Schema contract：Phase 1A migration 先建立完整 SQLite schema；repository / use case implementation 分批落地。
- External sync：先建立 External Work Item / Sync Intent / Sync Attempt storage contract，不實作 provider API calls。
- DB path：預設 `./data/ai-product-graph.sqlite`，可用 `AI_PRODUCT_GRAPH_DB_PATH` 覆蓋。
- Dependency installation：使用者手動執行 `pnpm install`，Codex 不自動安裝 dependencies。

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
│   │   ├── implementation-briefs/
│   │   ├── evidence/
│   │   └── external-sync/
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
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

`plane` / `github` adapter 第一階段可以先留 interface 或 adapter-owned DTO，不實作 provider API calls。External sync 的 durable storage contract 仍在 Phase 1A schema 中建立，避免後續整合回頭改 core tables。

## Phase 1 任務拆解

### 1. TypeScript Scaffold

Deliverables：

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- TypeScript 7 / `tsgo` 試用 scripts。
- TypeScript 6 fallback scripts。
- `vitest.config.ts`
- 基本 lint / format 設定，若一開始不想引入太多工具可延後。

驗收條件：

- 可以執行 TypeScript entrypoint。
- 專案 scripts 清楚，例如 `dev`、`build`、`typecheck`。
- `typecheck` 優先使用 TypeScript 7 / `tsgo`；若失敗原因是工具相容性，需能切回 TypeScript 6。
- Package manager 使用 `pnpm`。
- Dependency installation 由使用者執行 `pnpm install`。

### 2. Domain Models

Deliverables：

- Project entity。
- Repository entity。
- Idea entity。
- FeedbackRecord entity。
- ProductBrief entity。
- ProductBriefVersion entity。
- GraphDraftBatch entity。
- GraphDraftBatchChange entity。
- GraphNode entity。
- GraphEdge entity。
- GraphRevision entity。
- Ticket entity。
- TicketRevision entity。
- TicketDraftBatch entity。
- ImplementationTarget entity。
- RepositoryContextSnapshot entity。
- ImplementationBrief entity。
- ObservedEvidence entity。
- ImplementationResult entity。
- ResultAcceptance entity。
- ResultAcceptanceCriterionOutcome entity。
- ResultRevocation entity。
- Decision entity。
- ExternalContainer entity。
- ExternalWorkItem entity。
- ExternalWorkItemMapping entity。
- ExternalWorkItemSnapshot entity。
- ContentDrift entity。
- SyncConflict entity。
- SyncIntent entity。
- SyncAttempt entity。
- AuditLogEntry entity。

驗收條件：

- Domain models 不 import MCP SDK、SQLite driver、Plane SDK 或 GitHub SDK。
- 主要 entities 使用 ULID。
- 所有 entities 支援 `lifecycle_status`（active / archived）。
- 需要人類審查的 entities 另支援 `review_status`（draft / approved）。
- Idea Record、Feedback Record 與 Observed Evidence 不使用 `review_status`。
- Product Brief、Ticket 與 Implementation Target 是 stable identities；Product Brief Version、Ticket Revision、Implementation Brief 與 Implementation Result 是 immutable reviewed artifacts。
- Ticket `delivery_status` 與 `review_status`、`lifecycle_status` 分開。

### 3. Repository Ports

Deliverables：

- `ProjectRepository`
- `IdeaRepository`
- `ProductBriefRepository`
- `GraphRepository`
- `TicketRepository`
- `RepositoryContextRepository`
- `ImplementationBriefRepository`
- `ImplementationResultRepository`
- `ExternalSyncRepository`
- `AuditLogRepository`

驗收條件：

- Application use cases 只依賴 ports，不直接依賴 SQLite。
- Ports 使用 domain vocabulary 命名，不暴露 table-centric API。

### 4. SQLite Infrastructure

Deliverables：

- SQLite connection factory。
- Connection factory 對每個新 connection 啟用並驗證 `PRAGMA foreign_keys = ON`。
- Startup integrity check 在 migrations 完成後執行 `PRAGMA foreign_key_check`。
- Schema initialization，Phase 1A 直接建立 `docs/13-sqlite-schema.md` 定義的完整 schema contract。
- Migration runner，第一版可簡單讀取 ordered SQL files。
- `001_initial_schema.sql` 建立 tables。
- `002_initial_indexes.sql` 建立 indexes。
- SQLite implementations for first-slice repository ports。

驗收條件：

- 新環境啟動時可建立 database。
- 預設 database path 是 `./data/ai-product-graph.sqlite`。
- 可用 `AI_PRODUCT_GRAPH_DB_PATH` 覆蓋 database path。
- 每個 connection 必須在任何 migration、repository query 或 transaction 前執行 `PRAGMA foreign_keys = ON`，並讀回確認為 `1`；失敗時關閉 connection，server startup／connection acquisition 必須失敗。
- 唯一例外是明確標記的 referenced-table rebuild migration（ADR 0036）：connection 已完成 ON 驗證後，可在 transaction 外暫停 FK enforcement；migration transaction 內必須先完成 `foreign_key_check` 才記錄 version 並 commit，失敗則 rollback，finally 恢復並驗證 ON。此例外不適用 repository queries 或一般 transactions。
- 所有 pending migrations 完成後、server 開始服務前必須執行 `PRAGMA foreign_key_check`；任何 violation 都必須回報 storage integrity error 並停止啟動，不得自動刪除或修復資料。
- 重啟 server 後資料仍存在。
- Migration 必須一次建立完整 contract，即使第一批 use cases 只使用 projects / ideas / Product Brief / graph / tickets 的子集。
- 文件中的 schema SQL 可被 SQLite parser 接受。
- Mutating operations 會寫 audit log。
- 不實作 Plane / GitHub API calls；只建立外部同步需要的 durable tables 與 repository abstractions。

### 5. Application Use Cases

Deliverables：

- `CreateProject`
- `AddIdea`
- `CreateProductBriefDraft`
- `ApproveProductBriefVersion`
- `CreateGraphDraftBatch`
- `ApproveGraphDraftBatch`
- `CreateTicketDraftBatch`
- `CreateTicketRevisionDraft`
- `ApproveTicketRevision`
- `CreateImplementationBriefDraft`
- `ApproveImplementationBrief`
- `GetImplementationHandoff`
- `RecordObservedEvidence`
- `SubmitImplementationResult`
- `AcceptImplementationResult`
- `RevokeResultAcceptance`
- `ExportMarkdownDraft`

驗收條件：

- Use cases 回傳 structured result summary。
- Draft -> approve lifecycle 清楚，且每個 approval 都檢查 base pointer 或 source revision。
- Product Brief Version approval 後 Product Intent Reconciliation 變成 `pending`，直到 Graph Draft Batch approval。
- Graph Draft Batch approval 建立 Graph Revision；no-op reconciliation 也建立 Graph Revision。
- Ticket 只有 current approved Ticket Revision 後才可建立 implementation handoff。
- Implementation handoff 必須檢查 Handoff Freshness；stale 時回傳 `STALE_HANDOFF`。
- Observed Evidence 必須先透過獨立 use case 保存，且只綁定 Repository；record use case 必須用 Project-scoped idempotency key、repository、evidence type 與 server-computed payload hash 防止 retry 建立重複 evidence。Server 先套用 schema-defined semantic normalization，再以 RFC 8785 canonical JSON UTF-8 bytes + SHA-256 計算 payload hash；`payload_json` 保存實際被 hash 的 canonical JSON，Phase 1A 不保存 client 原始 payload。同一 Project 內同 key 重送時，只有 repository、evidence type 與 payload hash 都相同才回傳既有 evidence；任一不同必須回傳 `CONFLICT`。Implementation Result 只引用 evidence IDs，並在 Result 層級綁定 Implementation Target；同一 evidence 可被 target 屬於同一 Repository 的多個 Results 引用，但每個 Result 必須建立自己的 criterion verdicts，且 acceptance 不得跨 Result 傳遞。
- Result Acceptance 只有在 active draft Result、current sources 與 criterion verdicts 合法，且該 Result 從未建立 Acceptance 時成立；每個 Implementation Result 最多一次 Acceptance。`accept_implementation_result` 必須要求 Project + Local Actor scoped idempotency key，並在成功 transaction 中保存 Operation Receipt、normalized command hash 與原始成功 response data；receipt 必須只綁定本次 Result Acceptance，不得同時綁定 Result Revocation，且同一 Acceptance 最多只能有一筆 receipt。因 input 不帶 `project_id`，server 必須先由 `implementation_result_id` 做 identity-only resolution，只取得 Project scope，不檢查 lifecycle、current state 或 business validity；找不到 Result 時立即回傳 `NOT_FOUND`，不得查找或建立 receipt。解析成功後執行 receipt lookup，且只有 receipt miss 才做完整 Result target state validation。同 key 與相同 normalized command 命中 receipt 時直接 replay，即使 Result 已因原成功 acceptance 而不再是 active draft 或已有 Acceptance。Normalized command hash 必須由 RFC 8785 canonical JSON bytes + SHA-256 產生。相同 key 與相同 normalized command 重試時回放 response data，不重新寫入 Acceptance／Outcomes／Waiver Decisions／Ticket status；相同 key 不同 command 回傳 `CONFLICT`；不同 key 即使 command 相同也視為新的 logical command，若 Result 已因先前成功 acceptance 而不再可接受，回傳一般 `CONFLICT`，不得反查既有 Acceptance 當作 replay。Operation Receipt 與其 replay 路徑上的 Result、Acceptance、Revocation 都不得 hard delete；Result 只能 archive，其他三者永久保留。SQLite delete guards 必須無條件保護 Receipt、Acceptance、Revocation，並在 Result 已連到任一 receipt replay path 時保護該 Result。Operation Receipt 只保存 successful `ToolResult.data` 的 RFC 8785 canonical JSON UTF-8 text，不保存完整 envelope；replay 時 server 重新包成 `{ ok: true, data, audit_log_id? }`，且 top-level `audit_log_id` 必須使用原始成功 domain transaction 的 audit log ID，不得使用 replay observability log ID；也不得在 `data` 中新增 `replayed`、`receipt_id` 或其他 replay marker。Replay observability 只能透過 audit log、server log 或非 domain envelope metadata 表示，不得改變 `ToolResult.data`。Validation error、`NOT_FOUND`、`CONFLICT`、`STALE_HANDOFF` 或其他失敗不保存也不 replay。`submit_implementation_result` 只能提交 `satisfied` 或 `unsatisfied` verdict，不得提交 `waived`。每個 `satisfied` verdict 必須具有非空 reason，並至少引用一份屬於該 Result evidence set 的 Observed Evidence。`unsatisfied` verdict 也必須具有非空 reason，可不引用 evidence；未被 waiver input 指定的 `unsatisfied` 必須阻止 acceptance。Submission verdict、reason 與 evidence references 不可變；acceptance 必須為每項 criterion 另建 `satisfied` 或 `waived` outcome。Waiver Decision 必須由 Local Actor 在 `accept_implementation_result` 的同一 transaction 中提供理由並以 `decision_type = acceptance_criterion_waiver` 建立，由 `waived` outcome 同時引用對應 `unsatisfied` verdict 與該 Decision。Waiver Decision 的非空 `project_id` 必須由 Result Acceptance 衍生，Outcome、Verdict、Result 與 Decision 必須屬於同一 Project。任何仍有效的 Acceptance 都可 Revocation，不要求 Ticket 已是 `done`；Revocation 永久 archive Result，且每個 Result 最多一次。Ticket 為 `done` 時退回 `in_progress` 或 `blocked`，否則保留原 Delivery Status。被撤銷的 Result 不得重新接受，修正必須提交新 Result。

### 6. MCP Adapter

Deliverables：

- stdio MCP server。
- 官方 `@modelcontextprotocol/sdk` adapter。
- MVP MCP tools。
- MVP MCP resources。
- MVP MCP prompts。

驗收條件：

- Codex 可以啟動 MCP server。
- MCP client 可以建立 project、add idea、建立與核准 Product Brief Version、建立與核准 Graph Draft Batch、建立 Ticket Revision draft、讀取 graph/tickets context。
- MCP tool names 必須與 `docs/12-mcp-tool-spec.md` 一致，不使用舊的 `approve_product_brief` / `create_graph_draft` / `approve_ticket` 命名。

### 7. Markdown Adapter

Deliverables：

- Product Brief Markdown renderer。
- Ticket Markdown renderer。
- Implementation Brief Markdown renderer。
- Draft export path 規則。

驗收條件：

- Markdown 由 Product Brief Version、Ticket Revision、Implementation Brief 等 structured data render。
- Markdown 不作為 canonical source of truth。

### 8. Minimal Validation

Deliverables：

- Tool input validation。
- Product Brief JSON validation。
- Graph node / edge type validation。
- Ticket acceptance criteria validation。
- Base pointer / source revision validation。
- Handoff freshness validation。
- Observed Evidence payload validation for `commit`、`pull_request`、`test_execution`、`artifact`。
- Observed Evidence idempotency key validation。
- Result Acceptance operation receipt idempotency validation。
- External sync intent idempotency key validation。

驗收條件：

- 缺少 required fields 時，MCP tool 回傳清楚錯誤。
- 每個 approved Ticket Revision 必須連到至少一個 product goal 或 pain point。
- 每個 approved Ticket Revision 必須至少有一個 required Implementation Target。
- Empty Graph Draft Batch 必須有 `reconciliation_summary`。
- Phase 1A `record_observed_evidence` 必須嚴格驗證 `commit`、`pull_request`、`test_execution`、`artifact` 四種最小 payload schema；四種皆為 closed schema，未宣告欄位必須在 normalization 與 hashing 前拒絕。每個 payload 必須包含 `schema_version`，且 Phase 1A 只接受整數 `1`；版本欄位參與 canonicalization 與 hashing。`commit.changed_files` 必須是 string array 且欄位不可省略，但可為空陣列；entries 必須是 repository-relative POSIX paths，拒絕絕對路徑、反斜線與 `..` path segment，並在 payload hashing 前去重及依 Unicode code point lexical order 排序；空陣列不自動滿足任何 acceptance criterion。所有 timestamp fields 必須使用固定 UTC 毫秒格式 `YYYY-MM-DDTHH:mm:ss.sssZ`，並在 payload hashing 前驗證。`pull_request.status` 只允許 `draft`、`open`、`merged`、`closed`，`test_execution.status` 只允許 `passed`、`failed`、`errored`、`cancelled`。`test_execution.exit_code` 欄位必須存在：`passed` 必須為 `0`，`failed` 必須為非零整數，`errored` 與 `cancelled` 可為 `null` 或整數；`completed_at` 必須晚於或等於 `started_at`。
- `record_observed_evidence` 只保存格式、必填 repository identity、Project-scoped idempotency key、schema-normalized canonical payload、RFC 8785 + SHA-256 server-computed payload hash 與引用完整性有效的 machine evidence，不保存 client 原始 payload，也不接受 `implementation_target_id`、client-provided payload hash、AI interpretation 或 acceptance claim；同一 Project 內同一 key 重送時，只有 repository、evidence type 與 payload hash 都相同才回傳既有 evidence，任一不同回傳 `CONFLICT`。
- `submit_implementation_result` 可讓同一 Observed Evidence 被多個 Implementation Results 重用，前提是每個 Result 的 Implementation Target 都屬於該 evidence 的 Repository；每個 Result 必須獨立建立 criterion verdicts，且不得因其他 Result 已接受而自動通過。
- `submit_implementation_result.observed_evidence_ids` 必須定義該 Result 引用的完整 evidence set；每個 `criterion_verdicts[].evidence_ids` 必須是此集合的子集，引用集合外 evidence 時必須回傳 validation error。
- `observed_evidence_ids` 可包含未被任何 criterion verdict 引用的 evidence，以支撐 Result summary、unfinished items 或整體實作 provenance；未被 verdict 引用的 evidence 不得視為支撐任何 acceptance criterion，也不得影響 Result Acceptance。
- `satisfied` verdict 必須提供 trim 後非空的 `reason`，簡述 evidence 如何支撐 criterion，否則 `submit_implementation_result` 必須回傳 validation error。Draft Result 可保存 evidence list 為空但 reason 有效的 `satisfied` verdict 供後續修正；`accept_implementation_result` 必須拒絕任何未至少引用一份 Observed Evidence 的 `satisfied` verdict。
- `unsatisfied` verdict 必須提供 trim 後非空的 `reason`，否則 `submit_implementation_result` 必須回傳 validation error；其 evidence list 可為空，也可引用 failed test 等反證。除非 `accept_implementation_result` 的 waiver input 指定同一 criterion，否則兩種情況都必須使 Result 不具 acceptance eligibility。
- `submit_implementation_result` 的 `criterion_verdicts[].verdict` 只允許 `satisfied` 或 `unsatisfied`；若 client 提交 `waived`、`waiver_decision_id` 或任何 waiver decision payload，必須回傳 validation error。`accept_implementation_result` 不得修改 submission Verdict。對 `satisfied` Verdict 必須建立引用它的 `satisfied` outcome；對 waiver input 指定的 `unsatisfied` Verdict，必須由同一 Local Actor 在同一 transaction 建立 `decision_type = acceptance_criterion_waiver` 的 Decision 與引用兩者的 `waived` outcome。Waiver Decision 的 `project_id` 必須非空並由 Result Acceptance 衍生；client-provided waiver `project_id`、`decision_type` 或既有 Decision ID 必須拒絕。Trim 後的 waiver reason 必須寫入 `Decision.summary`；waiver actor 與 time 必須使用 `Decision.actor_id`、`Decision.created_at`，且 actor 必須等於 Result Acceptance actor。原 Verdict 的 reason 與 evidence references 必須保留；顯示或匯出 waiver 資訊時必須讀取 Decision，不得複製到 Verdict 或 outcome。`accept_implementation_result` input 必須要求 `idempotency_key`，並拒絕 client-provided `actor_id`、`accepted_at` 或其他 acceptance actor/time aliases；server 必須以目前 Local Actor 與 transaction clock 產生 canonical values。Server 必須保存 Project、Local Actor、operation name、idempotency key、normalized command hash、normalized command JSON 與原始成功 response data；相同 key 與相同 command 重試回放 response data，相同 key 但 command hash 不同回傳 `CONFLICT`。Transaction 開始時必須只擷取一次 event time，並重用於 Acceptance `accepted_at`、所有 Outcomes `created_at` 與本次 Waiver Decisions `created_at`，三者不得各自讀取 clock。Output 的 `result_acceptance` 必須回傳 `id`、`project_id`、`implementation_result_id`、`actor_id`、`accepted_at`；`actor_id` 與 `accepted_at` 是接受操作者與時間的唯一權威來源，Implementation Result 不得保存或回傳重複的 approval actor/time。每筆 `criterion_outcomes` 必須回傳完整 canonical fields：`id`、`result_acceptance_id`、`acceptance_criterion_id`、`submitted_verdict_id`、`outcome`、`waiver_decision_id`、`created_at`；沒有 waiver 時 `waiver_decision_id` 必須明確為 `null`。`criterion_outcomes` 必須依 approved Ticket Revision 中 `acceptance_criteria` 的原始順序回傳，不得依資料庫 row order 或 ID 排序；`waiver_decisions` 必須依其對應 Outcome 的位置回傳。同一 output 也必須回傳完整 `waiver_decisions` objects，不得只回傳 IDs。每個 `waived` outcome 的 `waiver_decision_id` 必須在該 array 中恰好對應一個 Decision。
- `accept_implementation_result` 必須拒絕已有 Result Acceptance 紀錄的 Implementation Result，即使舊 Acceptance 已被撤銷。`revoke_result_acceptance` input 必須要求 `idempotency_key` 與 `result_acceptance_id`，不得接受 `implementation_result_id` 代替。因 input 不帶 `project_id`，server 必須先由 `result_acceptance_id` 做 identity-only resolution，只取得 Project scope，不檢查 Acceptance／Result lifecycle、current state 或 business validity；找不到 Acceptance 時立即回傳 `NOT_FOUND`，不得查找或建立 receipt。解析成功後執行 receipt lookup，且只有 receipt miss 才由 Acceptance 反查並完整驗證對應 Result、Implementation Target 與 Ticket。Server 必須保存 Project、Local Actor、operation name、idempotency key、normalized command hash、normalized command JSON 與原始成功 response data；receipt 必須只綁定本次 Result Revocation，不得同時綁定 Result Acceptance，且同一 Revocation 最多只能有一筆 receipt。同 key 與相同 normalized command 命中 receipt 時直接 replay，即使 Acceptance 已因原成功 revocation 而不再有效或 Result 已 archived。Normalized command hash 必須由 RFC 8785 canonical JSON bytes + SHA-256 產生。相同 key 與相同 command 重試回放 response data；相同 key 但 command hash 不同回傳 `CONFLICT`；不同 key 即使 command 相同也視為新的 logical command，若 Acceptance 已因先前成功 revocation 而不再可撤銷，回傳一般 `CONFLICT`，不得反查既有 Revocation 當作 replay。Operation Receipt 只保存 successful `ToolResult.data` 的 RFC 8785 canonical JSON UTF-8 text，不保存完整 envelope；replay 時 server 重新包成 `{ ok: true, data, audit_log_id? }`，且 top-level `audit_log_id` 必須使用原始成功 domain transaction 的 audit log ID，不得使用 replay observability log ID；也不得在 `data` 中新增 `replayed`、`receipt_id` 或其他 replay marker。Replay observability 只能透過 audit log、server log 或非 domain envelope metadata 表示，不得改變 `ToolResult.data`。Validation error、`NOT_FOUND`、`CONFLICT`、`STALE_HANDOFF` 或其他失敗不保存也不 replay。已有 Revocation 的 Acceptance 必須拒絕。Ticket 為 `done` 時 command input `next_delivery_status` 必填且只能是 `in_progress` 或 `blocked`；Ticket 尚未完成時該 input 必須省略，並保留現有 Delivery Status。Result Revocation 必須保存不可變的 `previous_delivery_status` 與 `resulting_delivery_status`，不得把 input 欄位直接當成歷史紀錄。Input `reason` 必須建立 `decision_type = result_acceptance_revocation` 的 Decision 並寫入其 `summary`；Revocation 只保存 `decision_id`，reason、actor 與撤銷時間必須分別由 Decision 的 `summary`、`actor_id` 與 `created_at` 取得。Revocation 與 Decision 的 `project_id` 必須由 Result Acceptance 的非空 `project_id` 設定且完全相同。撤銷後的修正流程只能提交新的 Implementation Result。

### 9. Test And Smoke

Deliverables：

- Vitest setup。
- `pnpm smoke` script。
- Smoke script 驗證完整 migration、create project、add idea、Product Brief draft / approval、Graph Draft Batch / Graph Revision、record observed evidence、audit log。

驗收條件：

- `pnpm test` 可以執行 Vitest。
- `pnpm smoke` 可以在本機 SQLite database 上跑完第一批 repository / use case 驗收。
- 完整 schema migration smoke 必須先通過，確認 runtime connection 的 `PRAGMA foreign_keys` 為 `1`，且 `PRAGMA foreign_key_check` 結果為空；use case smoke 可分批擴展。

### 10. Codex MCP Setup Doc

Deliverables：

- `docs/15-codex-mcp-setup.md`

驗收條件：

- 文件說明如何 build server。
- 文件說明如何設定 Codex 使用 stdio MCP server。
- 文件說明本機 DB path 和 env override。

## 第一個 End-to-End Demo

Demo 流程：

```text
1. create_project
2. add_idea
3. 讀取 product-brief prompt
4. client agent 生成 Product Brief JSON
5. create_product_brief_draft
6. approve_product_brief_version
7. 讀取 extract-graph prompt
8. client agent 生成 graph nodes / edges
9. create_graph_draft_batch
10. approve_graph_draft_batch
11. 讀取 generate-tickets prompt
12. client agent 生成 tickets
13. create_ticket_draft_batch
14. approve_ticket_revision
15. create_implementation_brief_draft
16. approve_implementation_brief
17. get_implementation_handoff
18. record_observed_evidence
19. submit_implementation_result
20. accept_implementation_result
21. revoke_result_acceptance
22. export_markdown_draft
```

## Definition Of Done

Phase 1 完成時應具備：

- 本機 stdio MCP server 可啟動。
- SQLite database 可用完整 Phase 1A schema contract 建立和保存資料。
- 核心 use cases 走 DDD / ports & adapters。
- Product Brief Version、Graph Draft Batch、Ticket Revision、Implementation Brief、Implementation Result 都支援 draft first。
- Product Intent Reconciliation gate 與 no-op Graph Draft Batch reconciliation 已被 schema、use cases、MCP tools 一致支援。
- MCP resources 能讀 project context。
- Markdown draft export 可產出 human review 文件。
- 不依賴外部 provider API calls；外部同步只落地 durable storage contract。
