# ADR 0026：以 Optimistic Concurrency 拒絕 Stale Graph Batch

## Status

Accepted

## Context

Graph Draft Batch 是基於特定 canonical graph state 產生的候選變更。Batch 建立後，另一個 batch 可能先被核准並建立新的 Graph Revision。如果舊 batch 仍直接套用，它的 update 或 archive operations 可能覆蓋、忽略或破壞後續 graph 變更。

Server 可以嘗試自動 merge，但 entity identity、ownership scope 與語意關係衝突通常需要人類判斷。對單人 SQLite MVP 而言，明確拒絕 stale proposal 比實作不可靠的自動 rebase 更可預測。

## Options Considered

### A：Last Write Wins

優點：

- Approval workflow 最簡單。
- 舊 batch 不會被阻擋。

缺點：

- 可能靜默覆蓋較新的 graph changes。
- Batch review 時看到的 base state 與實際套用 state 不同。
- Audit 難以解釋遺失更新。

### B：Server 自動 Merge 或 Rebase

優點：

- 減少重新產生 batch 的操作。
- 無衝突變更可以快速繼續。

缺點：

- Graph identity 與語意衝突難以安全自動判斷。
- Approval 後實際套用內容可能不同於使用者審查的內容。
- Merge policy 會顯著增加 MVP 複雜度。

### C：Base Mismatch 時拒絕 Approval

優點：

- 使用者核准的內容永遠基於目前 graph state。
- 不會發生靜默 lost update。
- Conflict 行為簡單且可預測。

缺點：

- Graph 有後續變更時必須重新產生或 reconcile batch。
- 即使兩批變更實際互不衝突，也不能直接套用舊 batch。

## Decision

採用選項 C：每個 Graph Draft Batch 必須保存建立時的 `base_graph_revision_id`。Approval 必須在 transaction 內比較 batch base 與 Project 的 `current_graph_revision_id`。

兩者相同時才可繼續 validation 與原子套用。兩者不同時，tool 必須回傳 `CONFLICT`，包含 expected base 與 current Graph Revision IDs，且不得自動 merge、rebase 或部分套用。

Graph 尚未建立任何 revision 時，第一個 batch 可以使用 `null` base；只有 Project current Graph Revision 同樣為 `null` 時才能核准。

使用者若要保留舊 batch 的部分內容，必須基於目前 Graph Revision 建立新的 reconciled Graph Draft Batch。原 batch 保持不可變，供 review 與 audit，不得原地改寫 base。

Batch 成功核准並建立新 Graph Revision後，其他仍 active、且 base 因此不再 current 的 Graph Draft Batches 必須在同一 transaction 自動 archive。Approval result 與 audit log 必須列出被 archive 的 batch IDs。

## Rationale

- Batch approval 應套用使用者實際審查的 proposal，而不是 server 修改後的版本。
- Optimistic concurrency 能以低成本防止 lost updates。
- 明確 conflict 比隱含 graph merge 更符合可信 product context 的目標。

## Trade-offs

- 接受 stale batch 必須重新產生，即使變更看似互不衝突。
- 接受 graph editing workflow 可能因其他 approval 中斷。
- 延後自動 merge 或可視化 rebase tooling。

## Consequences

- Graph Draft Batch schema 必須包含 immutable `base_graph_revision_id`。
- Approval query 必須以 compare-and-swap 方式檢查 current revision。
- Base mismatch 必須回傳結構化 conflict details。
- Failed stale approval 不得建立 Graph Revision、修改 graph entities 或更新 batch Review Status。
- Reconciliation 必須建立新的 batch identity 與 current base reference。
- Successful approval 必須原子 archive stale sibling batches。
