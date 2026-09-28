# 知識圖譜模型

## 目的

知識圖譜要讓產品上下文可以被追溯：

```text
為什麼要做這個？
這是給誰用的？
哪些 tickets 實作它？
哪些 PR 改了它？
哪些檔案和測試相關？
哪些回饋影響了它？
```

## Node Types

| Type | 說明 |
| --- | --- |
| `idea` | 原始粗略想法或匯入的想法 |
| `product_brief` | 目前產品方向的穩定圖譜根節點 |
| `milestone` | Brief 下的階段成果、範圍與退出條件 |
| `spec` | Milestone 下的能力規格及實作／測試決策 |
| `product_goal` | 產品想達成的結果 |
| `persona` | 目標使用者類型 |
| `pain_point` | 使用者問題 |
| `workflow` | 使用者工作流或旅程 |
| `feature_area` | 大型產品能力區塊 |
| `epic` | 一組相關實作工作 |
| `ticket` | 可實作的工作項目 |
| `implementation_target` | Ticket Revision 中對應單一 repository 的 required delivery target |
| `external_work_item` | Plane、GitHub 等外部工具中的同步投影 |
| `acceptance_criterion` | 可驗證的完成條件 |
| `decision` | 產品或技術決策 |
| `repository` | 程式碼 repository |
| `code_file` | 原始碼檔案或模組 |
| `pull_request` | 實作工作的 PR |
| `test_case` | 與行為相關的測試 |
| `release` | Release 或 deployment |
| `feedback` | 使用者回饋或驗證結果 |

## 初始 Edge Types

| Relation | 意義 |
| --- | --- |
| `clarifies` | 一個 node 釐清另一個 node |
| `supports` | Node 支援某個 goal 或 decision |
| `solves` | Feature 或 ticket 解決某個 pain point |
| `belongs_to` | 子物件隸屬於父物件 |
| `depends_on` | 某項工作依賴另一個 node |
| `implements` | Ticket 或 PR 實作某個 feature |
| `validated_by` | 行為由測試或回饋驗證 |
| `changed_by` | Code file 被 PR 修改 |
| `traces_to` | 一般追溯關係 |
| `blocked_by` | 工作被另一個 node 阻擋 |

## MVP 儲存模型

本機 MCP server 先用 SQLite tables。Schema 要保持可攜，方便之後遷移到 Postgres。

```text
graph_revisions
  id
  project_id
  graph_draft_batch_id
  source_product_brief_version_id
  sequence_number
  created_at

graph_nodes
  id
  project_id
  type
  title
  description
  source
  external_ref
  metadata
  lifecycle_status
  created_in_graph_revision_id
  last_changed_in_graph_revision_id
  created_at
  updated_at

graph_edges
  id
  project_id
  source_node_id
  target_node_id
  relation_type
  confidence
  metadata
  lifecycle_status
  created_in_graph_revision_id
  last_changed_in_graph_revision_id
  created_at
  updated_at
```

## 為什麼先用 SQLite

SQLite 比較適合本機 MCP MVP：

- 不需要外部資料庫。
- 單人 agent workflow 安裝簡單。
- 早期 graph traversal 已經足夠。
- 讓第一個 demo 專注在 agent 是否有用。
- 等需要 hosted usage、團隊協作或 vector search 時，再遷移到 Postgres。

當產品需要 hosted persistence、多使用者或 `pgvector` 時，再移到 Postgres。只有當 graph query 成為瓶頸時，才考慮 Neo4j、Memgraph 或 ArangoDB。

## Graph 品質規則

- 新階層 Ticket 必須來自 Spec，保存 Spec → Milestone → Product Brief 完整來源鏈；full 未採用階層的舊專案才沿用 product goal／pain point 規則。
- 每個 Implementation Target 必須連到單一 Ticket 與單一 Repository；Ticket Revision 保存當版 required membership 與 scope。
- 新版 Ticket Revision 對同一 Repository 必須重用 active Target identity；移除時 archive，重新加入時建立新 identity。
- Product／project-level External Work Item 必須 `traces_to` Ticket；repository-specific External Work Item 必須 `traces_to` 單一 Implementation Target。
- 同一 internal owner 在同一 External Container 最多只能有一個 active External Work Item；替換時 archive 舊 mapping 並建立新 mapping。
- MVP 首次 External Work Item export 必須由使用者明確觸發；active mapping 才會 enrollment 後續 approved revision 與狀態同步。
- First export 必須引用 current approved Ticket Revision；repository-specific export 的 Implementation Target 必須屬於該 revision 且符合 External Container Repository。
- 外部 specification content 必須先保存為 immutable External Work Item Snapshot；與 approved Ticket Revision 不同時建立 Content Drift，不得直接改寫 canonical specification。
- Outbound content sync 只能更新 adapter-managed fields，且必須先驗證外部 concurrency token 仍符合最後同步 snapshot；external-only fields 不得修改。
- 每個 External Work Item 的 Sync Attempt 必須獨立且可冪等重試；partial failure 不得回滾內部 approval 或其他成功同步。
- 需要外部副作用的 domain transaction 必須原子寫入 durable Sync Intents；外部 API 只可在 commit 後呼叫。
- 同一 External Work Item 的 Sync Intents 必須依 per-mapping sequence 處理；只有尚未開始的 content updates 可被新版 supersede，lifecycle intents 不得省略。
- Terminal-failed content update 可由新版 desired content 取代而不重試；failed lifecycle intent 必須阻擋該 mapping 的後續 intents。
- 永久無法完成的 mapping 只能透過使用者 Decision 終止；archive 後才從 Sync Health 排除，且 failures 不得改寫為 success。
- Sync Health 必須由目前應同步 revision／event 與各 active mappings 的 latest attempts 衍生，不得手動更新。
- 每個 feature area 應該連到至少一個 persona 或 workflow。
- 每個 PR 應該連到至少一張 ticket。
- Core 的 Brief approval 自動同步根節點，Milestone／Spec 透過 `save_planning_node` 自動套用內容與關係，記錄 automation actor 與 applied audit，不另作 graph approval。
- Full 未採用階層的舊專案保留手動 Graph Draft Batch review／approval，以及帶有 `reconciliation_summary` 的 no-op reconciliation；手動工具不能修改新階層節點。
- 每次 Graph Draft Batch 成功套用都建立單調遞增的 Graph Revision；no-op batch 也建立 Graph Revision，但不修改任何 GraphNode 或 GraphEdge。
- Graph Revision 必須保存來源 Product Brief Version；成功核准對應 batch 時，Project 的 Product Intent Reconciliation pointers 必須在同一 transaction 前進。
- 根節點已對齊不代表下游來源有效。完整來源鏈必須重新比對；Milestone／Spec 依內容版本識別真正變更。相同內容的來源確認不使既有交付失效；真正變更、歸屬變動、封存及依賴問題仍阻擋 handoff／新 Acceptance。
- Graph changes 第一版使用簡單 audit log 追蹤，不做完整 event sourcing。

### Ticket ownership 與 revision provenance

Ticket canonical node 使用 Ticket ID，`type/source/source_ref_type = ticket`，`source_ref_id` 指向相同 Ticket。穩定 graph slug 為 `ticket:<Ticket ID>`，不以 title 或 Ticket slug 猜測 identity。Node 投影 aggregate 的 title／lifecycle；replacement draft 不改 title，approval 才同步。Archived Ticket 的 node 保留供歷史讀取。

產品意圖 node／edge 的 created-in 與 last-changed Graph Revision 必填。原 Ticket node 與 Ticket 間投影 edges 依 ADR0036 使用 nullable references；新增 Ticket → Spec 的 `belongs_to` edge 則引用來源 Graph Revision，metadata 保存建立投影的 Ticket Revision。Ticket writes 不建立產品意圖 Graph Revision，也不移動 Project reconciliation pointers。Milestone／Spec 的 `content_revision_id` 與每次保存的 Graph Revision 分開；來源鏈與內容版本依 ADR0040／0041 驗證，詳見 [階層規劃](23-planning-hierarchy.md)。
