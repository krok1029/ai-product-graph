# ADR 0035：以 Approved Graph Revision 對齊 Product Intent

## Status

Accepted

## Context

Product Brief Version 是 Project 產品意圖的權威來源，但 tickets、implementation handoffs 與 results 依賴的是由 Product Brief 衍生後的 canonical graph。新版 Product Brief Version 核准後，如果立刻全面重設 tickets，會不必要地破壞仍然有效的工作；如果完全不阻擋 handoff，又可能把尚未與新產品意圖對齊的 graph 交給 coding agent。

部分 Product Brief revision 可能只修正文案、補充非 graph-impacting 說明，與既有 graph 比較後沒有任何 node 或 edge 需要變更。這種情況仍需要留下「已比較且無須變更」的可稽核紀錄，否則 Product Intent Reconciliation 會永久停在 `pending`。

## Decision

新版 Product Brief Version 核准後，Project 的 Product Intent Reconciliation 先成為 `pending`。在 `pending` 期間，implementation handoff 與 Result Acceptance 必須被阻擋；Result submission 仍可保存 Observed Evidence，但 Result 本身建立為 archived stale draft。

Product Intent Reconciliation 只能透過來源為目前 approved Product Brief Version 的 approved Graph Draft Batch 完成。Batch 可以包含 scoped graph changes，也可以是 no-op reconciliation。No-op batch 的 `changes` 為空，但必須保存 `reconciliation_summary`，並經使用者明確核准。

任何 Graph Draft Batch 成功核准後都必須建立新的 Graph Revision，並在同一 transaction 推進 Project 的 `last_reconciled_product_brief_version_id` 與 `product_intent_graph_revision_id`。No-op Graph Revision 不修改任何 GraphNode 或 GraphEdge，也不推進任何 entity 的 last-changed revision；它只證明該 Product Brief Version 已與目前 graph 比較並確認無需 entity 變更。

Graph reconciliation 完成後，不得只因 Product Brief current pointer 改變就全面失效既有 Ticket Revisions。只有引用被更新或 archived product-intent nodes／edges 的 Ticket Revisions 需要 replacement revision；引用仍 active 且自其 source Graph Revision 後未變更的 Tickets、Implementation Briefs 與 Results 可以繼續有效。

## Rationale

- Product Brief approval 與 graph interpretation approval 是兩個不同的人類決策。
- Pending gate 防止 agent 使用尚未與最新產品意圖對齊的 graph 執行 handoff 或 acceptance。
- Scoped invalidation 避免因小幅 Product Brief revision 重設全部交付狀態。
- No-op reconciliation 讓非 graph-impacting revision 也能留下審查紀錄並解除 pending。
- Graph Revision 提供穩定的比較邊界，讓 Ticket applicability 與 handoff freshness 可以用 entity last-changed revision 判定。

## Trade-offs

- 接受 Product Brief approval 後還需要額外 graph reconciliation step。
- 接受系統必須保存 reconciliation pointers、Graph Revisions 與 no-op summaries。
- 接受 handoff 在 pending 期間會被保守阻擋，即使最後比較結果可能是 no-op。

## Consequences

- Product Brief Version approval 不得直接修改 canonical graph，也不得全面 archive 或重設 Tickets。
- Product Intent Reconciliation pending 期間必須阻擋 implementation handoff 與 Result Acceptance。
- Result submission 在 pending 期間仍保存有效 Observed Evidence，但 Result 必須是 archived stale draft。
- Graph Draft Batch approval 必須確認 source Product Brief Version 仍是 current approved version，且 base Graph Revision 仍是 current Graph Revision。
- Graph Draft Batch 可用空 changes 表示 no-op reconciliation，但必須有 reconciliation summary 與明確 approval。
- 每次成功 approval 都建立 Graph Revision；no-op revision 不修改 graph entities。
- Reconciliation 完成後，只讓引用實際變更或 archived graph entities 的 Ticket Revisions 失效。
- Handoff freshness 與 Result Acceptance validation 必須使用 Product Intent Reconciliation、Ticket source Graph Revision 與 referenced entity last-changed revision 共同判定。
