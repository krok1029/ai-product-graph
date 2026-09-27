# External Work Item 投影沿用外部 identity，不建立產品意圖 Graph Revision

## Status

Accepted

## Context

首次匯出成功需要將 Plane work item 追溯到 canonical Ticket。Graph Revision 記錄 Product Brief graph application；把 export 當成產品意圖 revision 會錯誤使既有 planning／handoff stale。ADR0036 已對 Ticket aggregate projection 允許 null provenance，但原 schema 尚未允許 External Work Item。

## Decision

將 ADR0036 的窄例外延伸至 canonical `external_work_item` node：ID 與 External Work Item 相同，slug 為 `external_work_item:<ID>`，source／source_ref_type 為 `external_work_item`，source_ref_id 為同一 ID，兩個 Graph Revision provenance 欄位皆 null。其他產品意圖 nodes 仍須有 revision provenance。

Create processor 在同一 fenced success transaction 保存 item、mapping、snapshot、node 與指向 owner Ticket 的 `traces_to` edge。Node title 使用當次 pinned Ticket title，外部原始內容與 concurrency token 留在 immutable snapshot。Nullable-provenance edge 除既有 Ticket lineage 外，只允許同 Project、已有一致 mapping 的 external item → Ticket trace；不得用此例外建立任意產品意圖 edge。

Projection 不推進 Project Graph Revision pointer；Product Brief graph workflow 的 ownership guards 保持有效。Processor 仍不接 production provider，mapping lifecycle 的後續同步由明確 workflow 擴充，不由 Graph Draft Batch 修改。

## Alternatives and Trade-offs

拒絕建立假的 Graph Revision：它不是產品意圖變更，會污染 freshness。拒絕建立第二套 external-only graph：它會割裂現有 node trace/traversal。接受額外 schema rebuild 與窄 provenance 例外，以維持同一 canonical graph。

Migration007 使用既有 `rebuild-with-integrity-check` 流程，保留 node columns、indexes、Ticket projection triggers 與外部 FK references；同 transaction 完成 integrity check，失敗 rollback，finally 恢復 FK。新 projection 只由成功 processor 建立；不以 display name 推測既有外部 identities。
