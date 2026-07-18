# ADR 0009：Graph Edits 使用簡單 Audit Log

## Status

Accepted

## Context

AI Product Graph 需要追蹤 graph nodes 和 graph edges 的變更。這些變更會影響 Product Brief、tickets、implementation brief 和後續 traceability。

候選方式包含直接 update、簡單 audit log、完整 event sourcing。

## Options Considered

### A：直接 Update Tables

優點：

- 最簡單。
- Schema 和 query 都直覺。
- MVP 開發最快。

缺點：

- 很難知道 graph 是如何演變的。
- AI 或使用者改錯時，不容易追蹤原因。
- 對產品決策追溯不足。

### B：簡單 Audit Log

優點：

- 可以追蹤誰在何時改了什麼。
- 實作成本可控。
- 足以支援 MVP 的 review、debug 和 traceability。
- 不需要引入 event sourcing 的複雜度。

缺點：

- 無法完整 replay state。
- 不保證所有 state 都能從 events 重建。
- 需要額外寫入 audit records。

### C：完整 Event Sourcing

優點：

- 可完整重播 graph 演化。
- 適合高度可追溯的知識系統。
- 長期審計能力最強。

缺點：

- MVP 過重。
- Query、projection、migration 都會變複雜。
- 會拉高 implementation 門檻。

## Decision

第一版採用選項 B：簡單 audit log。

Graph edits 不做完整 event sourcing。每次重要 mutation 需要記錄 action、entity type、entity id、actor、timestamp、before summary、after summary 和 metadata。

## Rationale

- MVP 需要知道 graph 怎麼被改動，但不需要完整 replay。
- Audit log 可以提供足夠的 traceability，同時保持資料模型簡單。
- 完整 event sourcing 會讓第一版過度設計。

## Trade-offs

- 接受第一版不能靠 events 完整重建 graph。
- 接受 audit log 是輔助追蹤，不是 source of truth。
- 之後如果需要完整 history replay，再重新評估 event sourcing。

## Consequences

- SQLite schema 應包含 `audit_log` table。
- MCP mutating tools 應寫入 audit records。
- Resources 可以在需要時提供 entity 的 audit history。
