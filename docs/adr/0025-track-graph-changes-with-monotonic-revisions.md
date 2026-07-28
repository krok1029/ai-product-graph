# ADR 0025：以單調遞增 Graph Revision 追蹤 Graph 變更

## Status

Accepted

## Context

Ticket Revision 可以在新版 Product Brief 後繼續使用，但前提是它引用的產品意圖 nodes 與 dependencies 沒有改變。只比較 `updated_at` 容易受到時鐘精度、同時寫入與排序不穩定影響；只依賴 audit log 則需要重播或複雜查詢，才能回答某個 node 是否在 Ticket Revision 核准後變更。

完整 graph snapshot 或 event sourcing 能提供更強歷史重建能力，但對本機 SQLite MVP 的成本過高。系統需要一個較輕量、可比較的 graph 變更邊界。

## Options Considered

### A：使用 Timestamp 或 Audit Log 判斷

優點：

- 不需要新增 revision model。
- 可沿用既有 audit infrastructure。

缺點：

- Timestamp 比較可能有精度與排序問題。
- Audit log 查詢難以直接回答 entity 是否晚於某個 graph state 變更。
- Ticket validity 規則容易散落在查詢邏輯。

### B：保存完整 Graph Snapshots 或採用 Event Sourcing

優點：

- 可以精確重建任意歷史 graph state。
- 具有完整的變更時間線。

缺點：

- Storage、migration、query 與 domain complexity 過高。
- 超出單人 SQLite MVP 的需求。

### C：每次 Batch 套用建立單調遞增 Graph Revision

優點：

- 可用簡單整數順序比較 entity 是否在某個 graph state 後變更。
- 不需要保存完整 snapshot 或重播 events。
- 與 Graph Draft Batch 的原子 transaction 邊界一致。

缺點：

- 無法只靠 Graph Revision 重建完整歷史內容。
- Schema 需要保存 created-in、last-changed 與 source revision references。

## Decision

採用選項 C：每次 Graph Draft Batch 成功原子套用時，必須在同一 transaction 中建立一個不可變 Graph Revision。

Graph Revision 具有穩定 ID 與 Project 內單調遞增的 `sequence_number`。Project 保存目前 Graph Revision reference；相同 Project 的 sequence number 必須唯一，且只在 batch 成功套用時前進。

Graph Revision 必須保存 `source_product_brief_version_id`。當來源等於目前 approved Product Brief Version 的 batch 成功核准時，同一 transaction 也必須更新 Project 的 `last_reconciled_product_brief_version_id` 與 `product_intent_graph_revision_id`，讓 Product Intent Reconciliation 成為 `current`。

No-op reconciliation batch 也必須建立 Graph Revision。這個 revision 不代表任何 GraphNode 或 GraphEdge 的 last-changed revision 前進，只代表來源 Product Brief Version 已與目前 graph 比較並確認無需 entity 變更。

每個 canonical GraphNode 與 GraphEdge 必須記錄 `created_in_graph_revision_id` 與 `last_changed_in_graph_revision_id`。每個 Ticket Revision 必須記錄核准時適用的 `source_graph_revision_id`。

若 Ticket Revision 引用的任一 GraphNode 或 GraphEdge，其 last-changed Graph Revision sequence 晚於 Ticket Revision 的 source Graph Revision，該 Ticket Revision 的來源已變更，不能直接用於新的 Implementation Brief。Archived source 同樣視為失效。

Graph Revision 不是完整 snapshot，也不是 event sourcing。Audit log 仍負責保存每次 batch 的具體新增、更新、archive 與 actor 資訊。

每個 Graph Draft Batch 必須保存建立時的 `base_graph_revision_id`，供 approval 執行 optimistic concurrency check；graph 尚無 current revision 時，第一個 batch 可以使用 `null` base。

## Rationale

- Monotonic sequence 提供穩定且低成本的變更順序。
- Batch approval transaction 是自然的 graph revision 邊界。
- No-op reconciliation 需要可稽核的 revision boundary，否則 Product Intent Reconciliation 可能永久停在 pending。
- Entity-level last-changed reference 足以支援 Ticket applicability 與 handoff freshness。
- 保留 audit log，可在不導入 event sourcing 的情況下追查變更細節。

## Trade-offs

- 接受 Graph Revision 只能判斷順序與有效性，不能單獨重建完整 graph snapshot。
- 接受所有 graph writes 必須經過 revision-aware transaction。
- 接受 Ticket Revision 與 graph entities 增加 revision reference 欄位。

## Consequences

- Storage 必須包含 `graph_revisions`，並對 `(project_id, sequence_number)` 建立唯一約束。
- Graph Revision 必須保存來源 Product Brief Version；Project 必須保存最後對齊的 Product Brief Version 與其 Graph Revision references。
- Project 必須保存 `current_graph_revision_id`。
- No-op Graph Revision 會推進 Project current Graph Revision 與 reconciliation pointers，但不更新任何 GraphNode 或 GraphEdge 的 last-changed reference。
- GraphNode 與 GraphEdge 必須保存 created-in 與 last-changed Graph Revision references。
- Ticket Revision approval 必須保存 `source_graph_revision_id`。
- Graph Draft Batch 套用失敗時，不得建立 Graph Revision 或增加 sequence number。
- Graph Draft Batch approval 必須比較 base 與 current Graph Revision，避免舊 batch 覆蓋後續變更。
- Ticket 與 handoff validation 必須以 Graph Revision sequence 比較來源是否仍有效。
