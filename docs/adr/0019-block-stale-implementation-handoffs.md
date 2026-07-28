# ADR 0019：阻擋 Stale Implementation Handoff

## Status

Accepted

## Context

ADR 0018 規定 Implementation Brief 核准前必須具有可驗證的 Repository Context Snapshot。然而 brief 核准後、coding agent 實際開始前，repository commit、dirty working state、current approved Ticket Revision、Ticket 引用的產品意圖 nodes 或 dependencies 都可能改變，來源也可能被 archived。Product Brief current pointer 也可能因與該 Ticket 無關的內容而改變。

如果 approval 時驗證一次後就永久允許 handoff，coding agent 可能在不同於 brief baseline 的程式碼上執行。只顯示 warning 並允許強制繼續，則會讓 approved Implementation Brief 的可靠性取決於每次操作人的判斷，無法形成一致的 handoff 契約。

## Options Considered

### A：只在 Approval 時驗證 Baseline

優點：

- Handoff 操作簡單。
- Client 不需要再次提供 repository state。

缺點：

- Approval 與 execution 之間的 repository drift 無法被發現。
- Brief 可能在過時背景上執行。

### B：Handoff 時驗證，但允許 Warning Override

優點：

- 可以偵測 drift。
- 緊急情況仍可快速繼續。

缺點：

- 相同 mismatch 可能被不同使用者以不同方式處理。
- 強制執行後，brief 與實際 baseline 不再一致。
- 後續追溯無法把 approved context 視為可靠契約。

### C：Handoff 時驗證，Stale 時一律阻擋

優點：

- Coding agent 每次都從與 approved brief 一致的 repository state 開始。
- Handoff 契約具有一致且可預測的語意。
- Drift 會透過新版 snapshot 與 brief 留下明確歷史。

缺點：

- Repository 有任何相關變動時都需要重新產生及核准 brief。
- 不提供人工強制繼續的捷徑。

## Decision

採用選項 C：每次 Implementation Brief 要交給 coding agent 前，系統必須驗證產品來源與 repository state。

綁定的 Ticket Revision 必須仍是 Ticket 的 current approved revision。Ticket Revision 引用的產品意圖 nodes 必須仍是 active，且自 revision 的 `source_graph_revision_id` 後未變更；dependencies 也必須仍有效。MCP client 同時必須回報目前 repository commit 與 dirty-state fingerprint，供系統與 brief 綁定的 Repository Context Snapshot 比較。

Implementation Brief 綁定的 Product Brief Version 保留為生成 provenance，但不要求仍是 Project 的 current approved version。Product Brief pointer 單獨改變不會使無關 Ticket 的 brief stale；只有 referenced intent nodes 或 dependencies 的相關變更才會失效。

新版 Product Brief 核准後，Project 的 Product Intent Reconciliation 會先成為 `pending`。在來源為該版本的 Graph Draft Batch 核准前，系統無法證明哪些 referenced nodes 未受影響，所有 handoff 必須回傳 `STALE_HANDOFF`，reason 為 `product_intent_unreconciled`。這個 gate 不會預先 archive briefs、重設 Tickets 或永久判定所有來源失效。

Reconciliation 完成後，只有 referenced nodes 被更新或 archived 的 Ticket Revisions 與 briefs 維持 stale；未受 scoped graph changes 影響者可繼續 handoff。

所有產品來源與 repository 條件都符合時，Handoff Freshness 才是 `current`，可以輸出 handoff。只要任一條件不符合或無法驗證，Handoff Freshness 即為 `stale`，系統必須阻擋 handoff，不得提供 warning override。

Stale 不會改寫 brief 原本的 approved Review Status。Replacement Ticket Revision approval 會把綁定舊 revision 的 active briefs archive，因此舊 brief 保留為 archived approved、freshness stale 的歷史 artifact。使用者必須以新的 Repository Context Snapshot 建立並核准新版 Implementation Brief，才能繼續。

Replacement Ticket Revision 核准時，所有綁定舊 revision 的 active briefs 必須以 `source_revision_superseded` archive，並因 revision mismatch 成為 stale；Ticket Delivery Status 同時原子重設為 `planned`。Brief Review Status 與歷史關係不變。

若 coding agent 已在 brief 尚 current 時開始工作，但 Result 提交前來源變 stale，系統仍保存格式與引用有效的 Observed Evidence，並建立標記 `stale_at_submission` 的 archived draft Result。該 Result 不得 acceptance；evidence 可在 current brief 的新 Result 中重用。

## Rationale

- Approval 證明的是特定內容與特定 baseline 曾被核准，不代表它永久適用。
- Execution-time validation 可以封閉 approval 與 coding agent 啟動之間的 drift window。
- 不允許 override，才能讓所有成功 handoffs 都具有相同的可靠性保證。

## Trade-offs

- 接受 repository 變動會中斷既有 handoff workflow。
- 接受重新產生及核准 brief 的額外成本。
- 接受 client 必須在每次 handoff 提供最新 repository state fingerprint。

## Consequences

- Handoff tool 必須要求目前 commit SHA 與 dirty-state fingerprint。
- Server 必須比較目前狀態與 brief 的 Repository Context Snapshot，並驗證 current approved Ticket Revision、referenced intent node activity／last-changed revision、dependencies 與所有相關來源 Lifecycle Status。
- Product Brief Version reference 只作為 provenance，不得只因 current pointer 改變就判定 stale。
- Product Intent Reconciliation pending 時必須以 `product_intent_unreconciled` 阻擋 handoff；完成後再依實際 scoped graph changes 判斷。
- Mismatch 或無法驗證時，tool 必須回傳明確的 stale error，且不得輸出可執行 handoff payload。
- Approved brief 的 Review Status、Lifecycle Status 與 Handoff Freshness 必須分開建模及顯示。
- Replacement Ticket Revision approval 必須使舊 revision briefs 衍生為 stale，並把 Ticket Delivery Status 重設為 `planned`。
- 舊 revision 的 active briefs 必須自動 archive，不得留下 active but permanently stale artifacts。
- Late result submission 必須保存 valid evidence，但 stale Result 只能成為 archived draft，不能 acceptance 或更新 Delivery Status。
- Audit log 應記錄 handoff 成功與因 stale 被阻擋的事件。
