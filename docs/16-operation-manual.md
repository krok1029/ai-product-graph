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

預設使用 core profile；日常操作請先看 [Skill 主導的本機工作流](./22-skill-led-workflows.md)。`get_work_context` 一次讀取 Ticket 工作上下文，`start_implementation` 合併核准與 handoff，`submit_work_result` 合併 evidence 與候選結果提交。六個舊 prompts 與外部整合介面只在 full profile 提供。

以下是保留的底層／full 相容模式 tools；後續逐步範例描述舊介面的細節，core 使用者由三個 skills 與新入口完成相同的資料流程：

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

現有功能與邊界驗收以 GitHub Issues／PR 為準；本機主要流程可用，不代表外部整合已提供。後續先依 [roadmap](08-roadmap.md) 驗證需求變更、跨對話接手及操作成本，暫不恢復外部整合開發。

Plane 已提供首次匯出與觀測，但後續 update/status execution 尚未交付；外部整合 MCP tools 需選用 full profile。

## 核心原則

1. Product Brief、Ticket 與交付決策可在對話核准；Milestone／Spec 與衍生圖譜依已授權規劃直接保存，不另核准。
2. Approved content 不原地改寫；修改時建立新 version／revision／brief／result。
3. Product Brief 是產品意圖的權威來源，Graph 與 Tickets 是衍生資料。
4. Product Brief 更新後須重新比對完整來源鏈；core 根節點自動同步不表示 Milestone／Spec 已確認。來源仍過期時不得繼續 handoff 或新 Result Acceptance。
5. Ticket 的規格狀態與交付狀態分開；只有 Result Acceptance 能讓 Ticket 成為 `done`。
6. 歷史資料以 archive 保留，不 hard delete。

## 直接在對話中核准

Agent 展示草稿內容與版本後，你可以直接說「可以」「同意，就這版」，不必再做一次正式核准、輸入版本 ID 或手動呼叫工具。Agent 會對你同意的版本呼叫核准工具，保存核准者、時間與版本，成功後回報結果。

你也可以說「上面這三張都可以」，一次核准已展示的三個草稿；agent 會分別保存並回報各張結果。若部分失敗，已成功的核准仍保留；版本衝突時重新取得目前內容，不把原同意套用到新版本。只有無法確定你是否同意、或同意哪個版本時，才需要釐清。

此方式適用 Product Brief、Ticket Revision、Implementation Brief 和 Implementation Result 的接受。一般同意不代表豁免未達成的驗收條件；需要 waiver 時仍須指定 criterion 與理由。後續新產生或修改的草稿需要你對其內容的新同意。

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

目前 Milestone／Spec 的保存與更新契約見 [階層規劃](23-planning-hierarchy.md)。以下標準流程採用 core；後續保留的 graph batch 步驟屬於 full 舊專案相容操作。

## 標準操作流程

```text
Project
  -> Idea
  -> Product Brief Draft
  -> Product Brief Approval
  -> Milestone（階段成果與完成條件）
  -> Spec（完整能力規格）
  -> Graph 自動同步（無額外核准）
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
- Product Intent Reconciliation 是 `current`，且準備使用的規劃來源鏈已重新比對；root current 不能代替下游確認。
- 使用目前 Graph Revision 與 stable entity IDs。

交給 coding agent 前：

- Ticket Revision 是 current approved。
- 每個 required Repository 都有 active Implementation Target。
- Implementation Brief 是 active approved。
- Core 的 `start_implementation`（full 底層為 `get_implementation_handoff`）通過真實 Repository baseline 與來源檢查，回傳 `freshness = current`。

接受實作前：

- Evidence 已保存且屬於正確 Repository。
- Result 引用完整 evidence set。
- 每項 criterion 都有 verdict、reason 與必要 evidence。
- Waiver 是使用者明確決策。
- Acceptance 使用穩定 idempotency key。

變更產品意圖後：

- 建立並核准新的 Product Brief Version。
- Core 自動同步根節點後，從上游重新比對受影響 Milestone／Spec；full legacy 才使用手動 batch／no-op reconciliation。
- 相同內容確認後重新查詢影響清單，仍有效的 Ticket／Brief／Result／Acceptance 沿用。
- 真正內容、歸屬、額外引用或依賴變更時，只修訂受影響工作；不自動撤銷有效歷史驗收。

## 文件閱讀路線

只想操作：

1. [使用者工作流](./02-user-workflows.md) 與 [精簡工作流](./22-skill-led-workflows.md)。
2. [Codex MCP Setup](./15-codex-mcp-setup.md) 與本手冊的對應章節。
3. 遇到 validation 時查 [階層規劃](./23-planning-hierarchy.md) 與 [MCP Tool Spec](./12-mcp-tool-spec.md)。

準備實作 server：

1. [Roadmap](./08-roadmap.md) 與此次對應的 GitHub Spec／Ticket。
2. [階層規劃](./23-planning-hierarchy.md)、[精簡工作流](./22-skill-led-workflows.md) 及相關 ADR。
3. [MCP Tool Spec](./12-mcp-tool-spec.md) 與 [SQLite Schema](./13-sqlite-schema.md)。
4. 追溯初始 scaffold 時才查 [Phase 1A](./14-phase-1a-scaffold-spec.md) 與 [原 Implementation Plan](./11-implementation-plan.md)，不把歷史切分當成新待辦。

理解產品與 domain：

1. [Vision](./00-vision.md)。
2. [Product Requirements](./01-product-requirements.md)。
3. [CONTEXT](../CONTEXT.md)。
4. [Knowledge Graph Model](./04-knowledge-graph-model.md)。

追查某項決策原因時才閱讀 `docs/adr/`。


## Plane container identity

先用 `register_external_container` 保存 Plane workspace 與 project 的穩定 identity：

```json
{
  "provider": "plane",
  "workspace_identity": "your-workspace-identity",
  "container_identity": "your-project-identity",
  "display_name": "Delivery"
}
```

不要提供 token 或 credentials。Identity 字串會 trim，且區分大小寫；不同 workspace 中同名的 container 分別保存。相同 identity 再次註冊會回傳原物件及 `created: false`，不同 display name 不會覆寫首次值。

使用 `list_external_containers({})` 或 `list_external_containers({provider: "plane"})` 查詢註冊結果，順序依建立時間與 id。Container 是全域資料，不需要 Project id；重啟 server 後仍可查到。

目前這一步只保存本機 identity，並不驗證 Plane 連線或建立外部 work item，也不啟用自動同步。後續 export 必須另行明確提出 request。

### 明確排入 Plane 首次匯出需求

取得 approved Ticket revision 與上述 container ID 後，呼叫 `request_plane_ticket_export({ticket_id, source_ticket_revision_id, external_container_id, idempotency_key})`。請保存此操作的 client key；網路中斷或 server 重啟時，以同 key／同 IDs 重送可取得原 intent 與 audit ID。此操作只排入本機 durable request，不代表 Plane work item 已建立。

使用 `get_sync_intent({sync_intent_id})` 讀取 pinned payload、request state 與 attempt history；`list_ticket_export_requests({ticket_id})` 列出該 Ticket 的歷史需求。正式 stdio 不會自動啟動 provider processor，正常新增需求會維持 `pending`、attempts 為空。不要用新 key 繞過 pending 或 failed request：同 Ticket／container 的 outstanding create 會被拒絕。首次 create execution 與 mapping enrollment 已可驗證；下述明確 CLI 可連線 Plane，update/status processor 與雙向同步尚未交付。

### 查詢已保存的 Plane work item 歷史

使用 `list_ticket_external_work_items({ticket_id})` 查看 Ticket 的全部有效身分關聯，包含已 archive 的 mapping；每筆回傳 mapping、External Work Item 與 snapshots。Mapping 依建立時間與 id 排序，每組 snapshots 依擷取時間與 id 排序。

取得 item 的內部 `id` 後，使用 `get_external_work_item({external_work_item_id})` 讀取該 item 的全部有效 mappings，以及跨 mappings 依時間排序的 snapshot history。請使用此穩定 id，不要傳顯示名稱、外部 URL 或外部系統的 item id。Ticket 已 archive 仍可讀歷史；沒有 mapping 的已知 Ticket 回空列表，無有效 mapping 的 Plane item 不會帶入無 owner scope 的 snapshots。

Snapshot 是當時保存的外部內容，包含 external status 與 concurrency token，並非目前 Ticket specification 或 live provider 狀態。讀取工具不連線 Plane、不建立 request／attempt／audit，也不改變內部 Ticket completion。排入 request 後須明確執行下述 CLI 才會連線 Plane；尚未執行時只有 pending 需求而沒有 External Work Item 是正常結果。Mapping 與 snapshot 查詢不連線外部，正式 stdio 不自動啟用 provider。

### 首次匯出執行核心（development API）

開發呼叫端使用 `createPlaneCreateProcessor(ports, provider, options?)`；factory 必定組合 `PlaneMappingEnrollment`，透過注入的 provider port 與 durable claims 處理已存在的 request；正式 stdio entrypoint 不會自行啟動它；HTTP adapter 與 credentials 由下述 CLI 明確裝配。每次 process 最多呼叫一次 create 或 reconciliation，每次皆有 durable attempt。

若 create 已可能送出，或外部成功後本機 commit 失敗，下一次必須先 reconciliation。`found` 可原子保存成功；`unknown` 保留 failure，不能盲目重建；只有 provider 能保證不存在且舊請求不會晚到的 `definitely_absent`，才允許後續另一個 attempt create。一般 404 不具備這項保證。Lease fencing 只保護本機 outcome commit，不能提供跨系統 exactly-once。

成功會同時保存 item、mapping、snapshot、graph trace、attempt outcome 與 audit，並在同一 transaction 呼叫 enrollment port 補上目前 desired state。Enrolled update／close／reopen intents 已持久化，但仍為 pending；尚未實作處理這些 intents 的 processor，不能把 active mapping 或單次 create 成功視為目前內容已同步，也不能視為整個 Phase 3 完成。


### Active mapping 的後續 outbox

只有已存在 active Plane Ticket mapping 才會自動 enrollment；註冊 container 或核准尚未 export 的 Ticket 都不會自行建立第一個 work item。

- 核准新版 Ticket Revision 時，每個 active mapping 在同一 domain transaction 保存 pinned `update`。`approve_ticket_revision` 的 `created_sync_intent_ids` 可用於 `get_sync_intent` 查詢；draft 與失敗 approval 不產生 intents。
- Result Acceptance 真正使 Ticket 進入 `done` 時保存 `close`；Revocation 真正離開 `done` 時保存 `reopen`。相同 receipt key 重送只回放原結果，不重複排入。Partial target acceptance/revocation 未跨越 done 邊界時不新增 lifecycle intent。
- Replacement revision approval 會把 done 重設為 planned，因此依序保存 update、reopen；先前的 close 保留。每個 mapping 使用獨立 key 與單調 sequence，所有 content/lifecycle intents 都保留，目前不做 coalescing。
- 首次 create 的 provider 呼叫期間，若已核准新版或 Ticket 已完成，mapping 成功 transaction 會固定當前 revision 補入 update／close。外部成功而本機 outbox 失敗時，mapping/outcome 一起 rollback；重啟後必須 reconciliation，再補入當時的 desired state。

開發驗證可執行 `pnpm exec vitest run src/application/plane-mapping-enrollment.test.ts src/application/plane-enrollment-catch-up.test.ts`。測試使用獨立 SQLite provider fixture，不需 credentials；正式 stdio 仍只提供本機 request 與 reads，沒有可偽造 provider success 的 mutation。

### 單次 Plane 首次匯出 CLI

先透過 MCP 註冊 External Container、明確呼叫 `request_plane_ticket_export` 並取得 `sync_intent.id`。Container 的 workspace identity 必須是 Plane workspace slug，container identity 是 Plane project ID。確認要匯出的既有 intent 後，在終端設定：

```sh
export AI_PRODUCT_GRAPH_DB_PATH=/absolute/path/to/ai-product-graph.sqlite
export AI_PRODUCT_GRAPH_PLANE_BASE_URL=https://api.plane.so
export AI_PRODUCT_GRAPH_PLANE_API_KEY='<your-api-key>'
pnpm plane:export -- <sync-intent-id>
```

Plane Cloud API origin 依 [官方 create API](https://developers.plane.so/api-reference/issue/add-issue) 為上述網址。Base URL 只接受 HTTPS origin；自架 Plane 使用其 API origin，不附 `/api/v1` 或其他 path。HTTP 僅允許 loopback，供本機測試。API key 僅從當次環境取得，不寫入 SQLite。可先執行 `pnpm plane:export -- --help`，不需要 key、也不開啟資料庫。Build 後可執行 `node dist/plane-export.js <sync-intent-id>` 或 `pnpm plane:export:built -- <sync-intent-id>`。

每次只接受一個既有 create intent，使用 15 秒 provider deadline 與 60 秒 lease。成功在 stdout 回 JSON 摘要，`succeeded`／`already_succeeded` exit 0；失敗 exit 1，參數或設定錯誤 exit 2。若 provider 已返回 failure，摘要包含 attempt ID，可用 `get_sync_intent` 查閱持久化原因。錯誤輸出不含原始 HTTP body、API key 或 stack。

已成功的 intent 再執行不會建立第二個 work item。若程序在外部建立後中斷，請等待原 lease 過期後用相同 intent ID 再執行；它會以穩定 markers 查找既有項目。只有唯一、身分相符的結果才補寫本機成功。404、空結果、查詢不完整或多筆結果仍是 unknown，不能證明先前 create 未發生，因此不會自動再 POST。即使前次是認證錯誤，修復 key 後若查無結果也保留此保守限制；目前沒有強制重送、假成功或 manual absence override。

此命令只交付首次 create／reconciliation。Mapping 的後續 update／close／reopen 會保存為 pending，CLI 不執行它們；stdout 的 create 成功不代表目前 revision 或 delivery status 已與 Plane 完全同步。一般 MCP server 啟動、Ticket approval 及 container 註冊都不會自動發送第一個外部 create。交付驗證使用 loopback HTTP，尚未對使用者的真實 Plane workspace 執行匯出。

### 讀取同步歷史與 Sync Health

`list_mapping_sync_intents({mapping_id})` 會回傳 mapping、經驗證的首次 create request，以及依 mapping sequence 排列的 update／close／reopen intents；每個 intent 都包含完整 attempt history。Archived history 保留。若 sequence 或來源證據不完整，歷史工具回傳明確錯誤，不把缺漏當成成功。

`get_mapping_sync_health({mapping_id})` 可查看單一 mapping 的衍生 health、必要 intent IDs、忽略的舊 content IDs 與原因。`get_ticket_sync_health({ticket_id})` 聚合全部 active Plane mappings，以及尚未建立 mapping 的 manual exports；相同內容亦可讀取 `product-graph://tickets/{ticketId}/sync-health`。既有 Ticket 與 Ticket-context resources 加入頂層 `sync_health` 摘要。

- `failed`：仍必要的義務，其最新 attempt 已失敗，且沒有成功 retry。任何 mapping 的必要 failure 都使 Ticket 為 failed。
- `pending`：沒有必要 failure，但有未完成、執行中或來源不完整的義務。失敗後正在 retry 時呈現 pending；查詢本身不回收 lease，也不執行 retry。
- `current`：目前所有必要義務已有成功結果。若完全沒有 enrollment 或 outstanding export，會同時顯示 `active_mapping_count: 0`、`outstanding_export_count: 0` 與 `not_enrolled`；這表示沒有既有同步義務，並不代表已匯出。

Active mapping 即使其 external item 已 archived，仍必須納入；只有 archived mapping 才排除。舊未開始的 content intent 沒有有效 supersession 關係時仍計入 pending；舊 terminal-failed content 可由新版完整內容取代 retry requirement。執行中的旧 update 必須等待 terminal，create／close／reopen 則不能被新版內容略過。來源缺漏只會產生保守診斷，不會由 read tool 補建 intents 或修正資料。

`approve_ticket_revision` 的成功資料現在附 `sync_health`，既有 `created_sync_intent_ids` 保留。其他 mapping 的未解決 lifecycle failure 不會撤銷已完成 approval；成功 approval 可以同時回傳 failed health。若 approval 提交後的 health 讀取暫時不可用，回傳 pending，使用讀取工具重新確認。

Acceptance／Revocation 的 immutable receipt response 維持原樣；重試會回放當時資料，請另呼叫 health tool 查看最新狀態。Health 不儲存為可手動設定的 Ticket 欄位，也不修改 Review／Lifecycle／Delivery Status。它只觀測目前 durable 義務，沒有呼叫 Plane 或檢查尚未觀測的外部內容 drift；update/status execution 與雙向同步仍未交付。

## 明確終止 mapping

不再需要同步某個 Plane item 時，可呼叫 `terminate_sync_mapping({ mapping_id, reason })`。Server 保存使用者 Decision、理由、時間與尚未完成的 mapped intents 清單，並在同一 transaction archive mapping。健康的 mapping 也可終止；failed／started outcomes 不會被改成成功，所有歷史與 errors 保留。

終止只停止後續 enrollment／排程，不修改遠端 item 或 Ticket Delivery Status，也不代表已送出的外部請求被取消。其他 mappings 照常納入 Sync Health。之後可用 NEW key 明確要求首次 export；重送舊 key 仍取得原本 request，不會建立第二個 mapping。這與先建立 replacement 再原子切換的流程不同。

### 查詢 mapping 終止歷史

`get_mapping_termination({mapping_id})` 與 `product-graph://external-work-item-mappings/{mappingId}/termination` 回傳同一份唯讀 snapshot。有效 mapping 尚未終止時 `termination` 為 `null`；未知 mapping 回 `NOT_FOUND`，identity、Decision 或停止 membership 的 scope 不一致回 `CONFLICT`。輸入只接受 trim 後非空的 `mapping_id`。

結果包含 `mapping_id` 與 `termination`。後者包含 `record`（`id`、`project_id`、`mapping_id`、`decision_id`、`stopped_sync_intent_ids`）、`decision`（`id`、`project_id`、`decision_type`、`summary`、`actor_id`、`created_at`），以及依 mapping sequence 排序的 `stopped_intents`。各 intent 沿用 `sync_intent`、`attempts`、`request_state` 格式；failed errors、started attempts 與 archived intents 原樣保留。成功 intents 與原始 manual create 不列入停止 membership；原始 create 可用既有 mapping sync history 查詢。

Archived mapping 的 health `current`／`included:false` 代表它已退出目前同步義務。此歷史查詢說明使用者何時、為何終止，而不把失敗宣稱成同步成功。查詢不呼叫 provider、不改寫 audit／actor／receipt，也不需要完整 create proof 才能讀取合法的 termination 紀錄。Started attempt 仍可能有未確認的外部結果；停止未來排程不等於撤回已送出的請求。

### 明確讀取 Plane 內容

已完成首次 export 的 active mapping 可明確執行一次觀測：

```sh
pnpm plane:observe -- <mapping-id>
# build 後：
node dist/plane-observe.js <mapping-id>
```

使用與 `plane:export` 相同的 `AI_PRODUCT_GRAPH_DB_PATH`、`AI_PRODUCT_GRAPH_PLANE_BASE_URL`、`AI_PRODUCT_GRAPH_PLANE_API_KEY`；actor 由 `AI_PRODUCT_GRAPH_ACTOR_ID`／`AI_PRODUCT_GRAPH_ACTOR_NAME` 指定，未設定時沿用 Local User。`pnpm plane:observe -- --help` 不需 credentials，也不開啟 database。每次只 GET 一個已知 Plane item，15 秒 deadline；不做重試或背景掃描。

成功的 stdout JSON 包含 `status: "captured"`、`mappingId`、`snapshotId`、`sourceTicketRevisionId`、`contentDriftId` 與 `auditLogId`。`contentDriftId: null` 表示此次比較沒有差異；有 drift 仍 exit 0，表示偵測及保存成功。未知 provider 結果或執行失敗寫入 stderr 並 exit 1；參數／設定錯誤 exit 2。錯誤不回傳原始 response body、URL、API key 或 stack；404 不證明項目已刪除，也不產生 snapshot。

每次成功觀測都保存獨立、不可變 snapshot；內容比較固定當次 commit 時的 current approved Ticket Revision，原始 create marker key 保持不變。只有 `name`、`description_html`、`external_source`、`external_id` 參與差異；外部 labels、assignees、status 等保留在 snapshot，不改動內部 specification 或 Delivery Status。HTML 採精確比較，provider 的空白或格式正規化也可能形成差異；drift 只代表觀測不一致，不等於證明有人手動編輯。

讀取不會改寫成功 outbound attempt 的 snapshot proof、mapping source revision 或 Sync Health，因此 Content Drift 可以與 health `current` 同時存在。重複命令會新增觀測，後來的 matching snapshot 不會解決舊 drift。若 GET 期間 mapping 已被終止或替換，當次結果回 conflict，不保存過時觀測。一般 stdio 啟動不連線 Plane；此命令不更新遠端內容或執行 update／close／reopen。


## 查詢 Content Drift 的處置與歷史（full）

觀測得到 `contentDriftId` 後，以 `get_content_drift_resolution({content_drift_id})` 或 `product-graph://content-drifts/{driftId}/resolution` 查詢。有效且未處置時 `resolution` 為 null；需要 mapping 全部觀測時，使用 `get_mapping_content_drift_history({mapping_id})` 或對應 `content-drifts` resource。每筆 drift 都包含相同的 `resolution`，其 `resolution_decision_id` 由有效處置關聯衍生。

Reject 顯示誰在何時、基於什麼理由不採用外部變動，`draft` 為 null。Adopt 顯示候選 Ticket Revision 與 base／source graph；請分別閱讀 `resolution.record.kind` 與 `resolution.draft.review_status`／`lifecycle_status`。已處置不表示候選已核准，已核准也不表示 Implementation Result 已接受或外部內容已更新；完成驗收與同步健康度須從各自的正式查詢確認。

歷史查詢固定保存時的 snapshot、captured revision 與 diff。後來候選核准或因 stale 被封存、Milestone／Spec 變更或 mapping 終止，都不抹除既有處置。單筆查詢不會因無關 observation 或 sync attempt 損壞而失敗；整份 mapping history 則會驗證其回傳的所有紀錄。真正不存在回 `NOT_FOUND`，已保存但關聯損壞或 unsupported legacy pointer 回 `CONFLICT`，不能把後者解讀為尚未處置。

這些介面只有 full profile 提供，全部為本機唯讀，不連線 Plane、不重算目前 revision 差異、不更新原始 drift、不新增 audit 或 actor。重複讀取與重新啟動可以安全地用於跨對話交接。
