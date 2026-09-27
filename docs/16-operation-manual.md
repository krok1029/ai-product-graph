# AI Product Graph 操作手冊

## 這份手冊的用途

這是 AI Product Graph 的日常操作入口。它回答「現在該做什麼、用哪個 MCP tool、成功後要檢查什麼」。

需要欄位級 input／output、validation 或資料表細節時，再查：

- [MCP Tool Spec](./12-mcp-tool-spec.md)：tool 的權威契約。
- [SQLite Schema](./13-sqlite-schema.md)：storage 與 integrity 規則。
- [Codex MCP Setup](./15-codex-mcp-setup.md)：build 與連線設定。
- [CONTEXT](../CONTEXT.md)：正式 domain vocabulary。

ADR 是決策歷史，不是日常操作手冊。一般使用時不需要逐篇閱讀。

## 目前可用程度

Repository 已提供完整本機主路徑：Project／Repository／Idea、Product Brief、Graph reconciliation、Ticket Revision、Implementation Brief／handoff、Evidence／Result submission、Result Acceptance／Revocation。另有 trace、MCP resources／prompts 與 Markdown export。`pnpm test` 的 stdio workflow 測試從空白 SQLite 開始，只透過 MCP 建立使用者資料，再驗證重啟後 receipt replay 與資料完整性。

目前已實作的 tools：

- `create_project`
- `list_projects`
- `get_project`
- `create_repository`
- `list_repositories`
- `add_idea`
- `get_idea`
- `create_product_brief_draft`
- `approve_product_brief_version`
- `create_graph_draft_batch`
- `approve_graph_draft_batch`
- `get_graph_context`
- `get_node_trace`
- `create_ticket_draft_batch`
- `create_ticket_revision_draft`
- `approve_ticket_revision`
- `get_ticket_context`
- `create_implementation_brief_draft`
- `approve_implementation_brief`
- `get_implementation_handoff`
- `record_observed_evidence`
- `submit_implementation_result`
- `accept_implementation_result`
- `revoke_result_acceptance`
- `export_markdown_draft`

開始 repository-backed 工作前，以 `create_repository` 建立 Project 範圍內的 Repository identity；可用 `list_repositories` 查詢既有 identity。此操作只保存 metadata，不掃描本機檔案，也不驗證遠端存取權。後續 Ticket targets、handoff 與 evidence 都使用回傳的 `repository.id`。

現有功能與邊界驗收以 GitHub Issues／PR 為準；本機主要流程可用，不代表外部整合已提供。

外部 Plane／GitHub 同步目前只有資料模型與 durable outbox contract，尚未提供完整的使用者操作 tools。

## 核心原則

1. AI 產生的是 draft，使用者明確 approval 後才成為目前有效版本。
2. Approved content 不原地改寫；修改時建立新 version／revision／brief／result。
3. Product Brief 是產品意圖的權威來源，Graph 與 Tickets 是衍生資料。
4. Product Brief 更新後，必須完成 Graph reconciliation 才能繼續 handoff 或 Result Acceptance。
5. Ticket 的規格狀態與交付狀態分開；只有 Result Acceptance 能讓 Ticket 成為 `done`。
6. 歷史資料以 archive 保留，不 hard delete。

## 狀態速查

| 狀態 | 適用對象 | 意義 |
| --- | --- | --- |
| `draft` | Product Brief Version、Graph Draft Batch、Ticket Revision、Implementation Brief、Implementation Result | 等待審查 |
| `approved` | 同上 | 已經明確核准 |
| `active` | 目前仍有效的 entity／artifact | 可參與目前流程 |
| `archived` | 歷史 entity／artifact | 保留追溯，但不參與新流程 |
| `planned` | Ticket | 尚未開始交付 |
| `in_progress` | Ticket | 正在實作 |
| `blocked` | Ticket | 實作受阻 |
| `done` | Ticket | 所有 required targets 都有 accepted Result |

`review_status`、`lifecycle_status` 與 `delivery_status` 是三條獨立狀態軸，不要互相代用。

## 標準操作流程

```text
Project
  -> Idea
  -> Product Brief Draft
  -> Product Brief Approval
  -> Graph Draft Batch
  -> Graph Batch Approval / Reconciliation
  -> Ticket Revision Draft
  -> Ticket Revision Approval
  -> Implementation Brief Draft
  -> Implementation Brief Approval
  -> Handoff
  -> Observed Evidence
  -> Implementation Result Draft
  -> Result Acceptance
  -> Ticket Done
```

### 1. 建立 Project

使用：

- `create_project`
- `list_projects`
- `get_project`

操作：

1. 用 `create_project` 建立產品規劃工作區。
2. 保存回傳的 `project.id`；後續 Idea、Brief、Graph、Ticket 與 Evidence 都在此 Project scope 內。
3. 用 `get_project` 確認 Project 是 `active`。

可對 Codex 說：

> 建立一個名為「AI Product Graph」的 Project，描述為「MCP-first product planning system」。

### 2. 保存原始 Idea

使用：

- `add_idea`
- `get_idea`

操作：

1. 把使用者原始輸入交給 `add_idea`。
2. 不要先讓 AI 改寫再保存；Idea Record 要保留來源原文。
3. AI 的整理與推論應進入後續 draft，不應覆蓋 Idea。

完成條件：

- Idea 屬於正確 Project。
- `lifecycle_status = active`。

### 3. 產生並核准 Product Brief

使用：

- prompt：`product-brief`
- `create_product_brief_draft`
- `export_markdown_draft`
- `approve_product_brief_version`

操作：

1. 讀取 `product-brief` prompt，讓 client agent 產生符合 schema 的 Product Brief JSON。
2. 第一版以 `base_approved_version_id = null` 建立 draft。
3. 匯出 Markdown 或直接審查 JSON。
4. 確認 product goal、target users、pain points、workflows、MVP scope、non-goals、metrics、risks 與 open questions。
5. 明確核准 Product Brief Version。

修改既有 Product Brief：

1. 讀取目前 approved version。
2. 以該 ID 作為新 draft 的 `base_approved_version_id`。
3. 建立並核准新 version，不修改舊 version。

核准後的重要結果：

- 新 version 成為 Product Brief current approved version。
- Product Intent Reconciliation 變成 `pending`。
- 在 reconciliation 回到 `current` 前，不要進行 implementation handoff 或 Result Acceptance。

### 4. 對齊 Knowledge Graph

使用：

- prompt：`extract-graph`
- `get_graph_context`
- `create_graph_draft_batch`
- `approve_graph_draft_batch`
- `get_node_trace`

操作：

1. 讀取目前 graph context。
2. 比較 approved Product Brief Version 與目前 Graph Revision。
3. 建立包含 `add`、`update`、`archive` changes 的 Graph Draft Batch。
4. 審查整個 batch，再原子核准。

如果沒有 graph changes：

- 仍要建立 no-op Graph Draft Batch。
- `changes` 使用空陣列。
- 提供非空 `reconciliation_summary`，說明已比較且無需修改。
- 核准後仍會建立新 Graph Revision，並把 Product Intent Reconciliation 推進為 `current`。

不要做：

- 逐筆核准 batch 中的 node／edge。
- 在 base revision 已 stale 時自動 merge。
- Product Brief 改版後跳過 reconciliation。

### 5. 產生並核准 Tickets

使用：

- prompt：`generate-tickets`
- prompt：`review-ticket-quality`
- `create_ticket_draft_batch`
- `create_ticket_revision_draft`
- `approve_ticket_revision`
- `get_ticket_context`

操作：

1. 從目前 Graph Revision 與 active product-intent nodes 產生 Ticket drafts。
2. 每個 Ticket 至少要有：
   - title
   - 一項 acceptance criterion
   - 至少一個 related graph node
   - 至少一個 Repository-specific implementation target
3. 個別審查並核准 Ticket Revision；Ticket Draft Batch 不是原子核准單位。
4. 確認 dependencies 已有 approved revision。

修改 Ticket 規格：

1. 使用 current approved revision ID 作為 `base_approved_revision_id`。
2. 建立 replacement Ticket Revision draft。
3. 核准後 Ticket Delivery Status 會重設為 `planned`。
4. 舊 revision 的 active Briefs 與 Results 會 archive，但歷史 Acceptance 與 Evidence 保留。

不要直接修改 approved Ticket Revision。

### 6. 建立 Implementation Brief 與 Handoff

使用：

- prompt：`implementation-brief`
- `create_implementation_brief_draft`
- `approve_implementation_brief`
- `get_implementation_handoff`

每個 Implementation Target 都要各自操作一次；不同 Repository 不共用同一份 Brief。

操作：

1. Client agent 讀取 Repository，提供 repository summary、file list、module notes 與 baseline。
2. 建立 Implementation Brief draft。
3. 審查 implementation plan、files、test strategy、risks 與 PR summary。
4. 核准 Brief。
5. Coding agent 開工前，用目前 commit SHA 與 dirty-state fingerprint 呼叫 `get_implementation_handoff`。

只有 `freshness = current` 時才能把 handoff 交給 coding agent。

每次成功或既有 Brief 因 stale 被阻擋，都會保存一筆 handoff audit，包含 Project、Brief、server LocalActor、時間及 stale 原因。這只新增觀測紀錄，不改寫 approved artifacts 或 Ticket 交付狀態；重複嘗試各自記錄。未知 Brief 不建立 audit。Audit 不保存原始 client repository context 或 dirty-state fingerprint。

如果 audit 無法保存，tool 回傳 `STORAGE_ERROR`，不會回報成功；修復 storage 後才重新嘗試。


收到 `STALE_HANDOFF` 時：

- `product_intent_unreconciled`：先完成 Graph reconciliation。
- Ticket Revision 不再 current：建立新 Brief。
- Product-intent node 已變更或 archived：修訂 Ticket，再建立新 Brief。
- Repository baseline 不一致：重新擷取 repo context 並建立 replacement Brief。

### 7. 保存 Observed Evidence

使用：

- `record_observed_evidence`

支援的 evidence types：

- `commit`
- `pull_request`
- `test_execution`
- `artifact`

操作：

1. 每份 evidence 使用穩定且具語意的 `idempotency_key`。
2. Evidence 必須指向正確 Project 與 Repository。
3. Payload 必須包含 `schema_version = 1`，並符合該 evidence type 的 closed schema。
4. 保存回傳的 Observed Evidence ID，供 Result 引用。

Evidence 只表示系統保存了 client 回報的機器紀錄。它不是 Acceptance，也不會把 Ticket 設為 `done`。

Idempotency 規則：

- 同一 Project、同一 key、相同 repository／type／payload：回傳原 evidence。
- 同一 key 但內容不同：`CONFLICT`。
- Retry 時沿用原 key，不要產生新 key。

### 8. 提交 Implementation Result

使用：

- `submit_implementation_result`

操作：

1. 指定實際使用的 approved Implementation Brief。
2. 列出 Result 的完整 `observed_evidence_ids`。
3. 對每項 acceptance criterion 提交一個 verdict：
   - `satisfied`
   - `unsatisfied`
4. 每個 verdict 都要有非空 reason。
5. `satisfied` criterion 在接受前至少要引用一份同 Result evidence set 內的 evidence。
6. 記錄 unfinished items。

不要在 submission 中使用 `waived`。Waiver 是使用者在 Result Acceptance 時作成的 Decision。

如果來源已 stale：

- 有效 Evidence 仍會保存。
- Result 會成為 archived draft，並標示 stale reasons。
- 該 Result 不可接受，也不會改變 Ticket status。
- 修正來源後要提交新的 Result。

### 9. 接受 Result 並完成 Ticket

使用：

- `accept_implementation_result`

操作前確認：

- Product Intent Reconciliation 是 `current`。
- Result 是 active draft。
- Ticket Revision、Implementation Target、Brief 與 graph sources 仍 current。
- 每項 criterion 都能形成 `satisfied` 或使用者明確 `waived` 的 outcome。

Waiver：

- 只能針對 submission 中的 `unsatisfied` verdict。
- 必須提供非空理由。
- 系統會建立不可變的 Waiver Decision。

Idempotency：

- 每次 logical acceptance command 產生一個穩定 `idempotency_key`。
- Network retry 必須使用同一 key 與完全相同的 command。
- 同 key、同 command 會 replay 原成功 response。
- 同 key、不同 command 會回 `CONFLICT`。
- 不同 key 永遠代表新的 command，不可拿來模擬 retry。

完成條件：

- 目前 Ticket Revision 的每個 required Implementation Target 都有 active approved Result。
- 條件全部成立後 Ticket 才會成為 `done`。

### 10. 撤銷錯誤的 Acceptance

使用：

- `revoke_result_acceptance`

只在原 Acceptance 作成當時就無效時使用，例如證據無效或 criterion 實際未滿足。

操作：

1. 使用 `result_acceptance_id`，不要用 Result ID 代替。
2. 提供明確 reason。
3. 如果 Ticket 是 `done`，指定 `next_delivery_status` 為 `in_progress` 或 `blocked`。
4. 如果 Ticket 尚未 `done`，省略 `next_delivery_status`。
5. Retry 沿用相同 idempotency key 與相同 command。

結果：

- 原 Result 永久 archive。
- 原 Result、Acceptance、Outcomes 與 Evidence 保留。
- 被撤銷的 Result 不可重新接受。
- 修正後提交新的 Implementation Result。

不要用 Revocation 處理：

- 新需求。
- 後續 regression。
- 原 acceptance criteria 沒有涵蓋的工作。

以上情況應建立 Follow-up Ticket，並以 `traces_to` 連回原 Ticket。

核准後可透過 `get_ticket_context` 或 Ticket context resource 的 `traced_ticket`、`trace_edge` 查看目前正式關係；未核准 replacement draft 不會改變它。原 Ticket 即使 archived 仍會顯示於 context；一般 `get_node_trace` 則只遍歷 active nodes。

## 常見錯誤處理

| Error | 常見原因 | 操作 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 缺欄位、enum 錯誤、closed schema 出現未知欄位 | 依 Tool Spec 修正 input；不要換 idempotency key 掩蓋問題 |
| `NOT_FOUND` | ID 不存在或不在正確 Project | 重新讀取 Project／Ticket context，確認使用 stable ID |
| `CONFLICT` | base pointer stale、revision stale、idempotency key 被不同 command 重用 | 讀取最新 current pointer；重新建立 draft，或修正 client retry |
| `STALE_HANDOFF` | Product Intent 未對齊、Ticket／Brief／repo baseline 過期 | 依 reason 完成 reconciliation 或建立 replacement artifact |
| `STORAGE_ERROR` | migration、query、transaction 或 integrity check 失敗 | 停止寫入，保留 DB，檢查 log；不要手動刪除歷史 rows |
| `INTERNAL_ERROR` | 未預期 server 錯誤 | 保存 request context 與 audit reference，修正 server 後重試 |

失敗 response 不會建立 Operation Receipt。修正失敗原因後，可以用原 idempotency key 重新嘗試；只有成功 command 才會成為可 replay 的 receipt。

## 常用讀取入口

Resources：

```text
product-graph://projects
product-graph://projects/{projectId}
product-graph://projects/{projectId}/brief
product-graph://projects/{projectId}/graph
product-graph://projects/{projectId}/tickets
product-graph://tickets/{ticketId}
product-graph://tickets/{ticketId}/context
product-graph://nodes/{nodeId}
product-graph://nodes/{nodeId}/trace
```

Prompts：

```text
product-brief
extract-graph
generate-tickets
implementation-brief
review-ticket-quality
trace-feature-context
```

## 啟動與資料安全

Build、Codex stdio 設定與 DB path 請依 [Codex MCP Setup](./15-codex-mcp-setup.md)。

Server 啟動時必須：

1. 對每個 SQLite connection 執行 `PRAGMA foreign_keys = ON`。
2. 讀回確認 `PRAGMA foreign_keys = 1`。
3. 完成 pending migrations。
4. 執行 `PRAGMA foreign_key_check`。
5. 只有 integrity check 無任何 rows 時才開始提供 MCP tools／resources。

Integrity check 失敗時不可自動刪除或修復資料。

## 每日操作檢查表

開始規劃前：

- Project 與 Repository identities 正確。
- Product Brief 有 current approved version。
- Product Intent Reconciliation 是 `current`。
- 使用目前 Graph Revision 與 stable entity IDs。

交給 coding agent 前：

- Ticket Revision 是 current approved。
- 每個 required Repository 都有 active Implementation Target。
- Implementation Brief 是 active approved。
- `get_implementation_handoff` 回傳 `freshness = current`。

接受實作前：

- Evidence 已保存且屬於正確 Repository。
- Result 引用完整 evidence set。
- 每項 criterion 都有 verdict、reason 與必要 evidence。
- Waiver 是使用者明確決策。
- Acceptance 使用穩定 idempotency key。

變更產品意圖後：

- 建立並核准新的 Product Brief Version。
- 完成 Graph reconciliation，包含 no-op 情況。
- 檢查受影響 Tickets 是否需要 replacement revision。
- 只有 referenced product-intent nodes 被更新或 archived 的 Tickets 才建立 replacement revision，並為其 current targets 重建 Implementation Brief／handoff。

## 文件閱讀路線

只想操作：

1. 本手冊。
2. [Codex MCP Setup](./15-codex-mcp-setup.md)。
3. 遇到 validation 時查 [MCP Tool Spec](./12-mcp-tool-spec.md)。

準備實作 server：

1. [Phase 1A Scaffold Spec](./14-phase-1a-scaffold-spec.md)。
2. [Implementation Plan](./11-implementation-plan.md)。
3. [MCP Tool Spec](./12-mcp-tool-spec.md)。
4. [SQLite Schema](./13-sqlite-schema.md)。

理解產品與 domain：

1. [Vision](./00-vision.md)。
2. [Product Requirements](./01-product-requirements.md)。
3. [CONTEXT](../CONTEXT.md)。
4. [Knowledge Graph Model](./04-knowledge-graph-model.md)。

追查某項決策原因時才閱讀 `docs/adr/`。
