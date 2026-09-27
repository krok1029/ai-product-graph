# ADR 0015：以具範圍的變更 Batch 協調 Product Graph

## Status

Accepted

## Context

ADR 0014 規定 AI 產生的 graph 以 Graph Draft Batch 原子核准，但尚未定義新版 Product Brief 所產生的 batch 如何作用於既有 canonical graph。

Graph 同時包含產品規劃資料，例如 product goal、persona、workflow、feature area 與 ticket，也包含 Repository、code file、pull request、test case 等實作追蹤資料。若每次萃取都整張替換 graph，實作追蹤資料會被誤刪；若只把新結果追加到 graph，則會累積重複、過時或互相矛盾的產品規劃實體。

AI 也可能無法可靠判斷新版內容中的實體是否與既有 node 相同。自動合併錯誤實體會破壞 graph 的語意與追溯關係。

## Options Considered

### A：整張替換 Canonical Graph

優點：

- 更新規則簡單。
- Graph 可直接反映最新一次萃取結果。

缺點：

- 會覆蓋不屬於 Product Brief 萃取範圍的實作追蹤資料。
- 既有 graph identity 與外部參照可能失效。
- 難以保留歷史關係與變更原因。

### B：把新萃取結果直接追加到 Graph

優點：

- 不會覆蓋既有資料。
- 寫入流程簡單。

缺點：

- 容易產生重複 nodes 與 edges。
- 過時內容仍會留在 active graph。
- 後續 consumers 無法判斷哪個實體代表目前產品意圖。

### C：以具範圍的變更 Batch 協調既有 Graph

優點：

- 每項新增、更新與封存都可在核准前審查。
- 可保留穩定 identity、來源版本與歷史追溯。
- Product Brief 只修改其擁有的產品規劃範圍。
- 身分不確定時可阻止錯誤自動合併。

缺點：

- AI client 必須產生 change proposal，而不只是完整 node 清單。
- Server 必須驗證變更範圍、identity 與衝突。
- 使用者可能需要額外處理 entity matching 衝突。

## Decision

採用選項 C：當 canonical graph 已存在時，Graph Draft Batch 必須表達一組具範圍的候選變更，明確列出要新增、更新或封存的 nodes 與 edges。核准後，整個變更集以單一原子操作套用。

若 comparison 結果顯示 graph 不需要修改，Graph Draft Batch 可以保留空 changes 作為 no-op reconciliation。No-op batch 必須保存 `reconciliation_summary`，核准後建立 Graph Revision 並推進 Product Intent Reconciliation pointers，但不修改任何 GraphNode 或 GraphEdge。

Product Brief 萃取只能修改產品規劃範圍內的 graph entities。Repository、code file、pull request、test case 等實作追蹤資料由其各自的輸入或整合流程擁有，不得被 Product Brief 的重新萃取覆蓋或封存。

如果系統無法確定候選實體是否對應既有 identity，Graph Draft Batch 必須標示衝突並阻止核准。衝突只能在使用者明確選擇合併、建立新實體或改指向既有實體後解除。

新版 Product Brief 核准後、對應 batch 核准前，系統不得猜測哪些 Tickets 受影響，也不得預先全面 archive 或重設它們；Project 以 `pending` Product Intent Reconciliation 阻擋 handoff。Batch 核准完成後，只有引用被更新或 archived nodes 的 Ticket Revisions 失效；引用 nodes 保持 active 且未變更的 Tickets、Briefs 與 Results 繼續有效。

## Rationale

- Graph 是多種資料來源共同維護的長期知識模型，不是單次 AI 輸出的暫存結果。
- 具範圍的變更集可避免整張替換與盲目追加的資料破壞。
- 明確 ownership 可防止一個來源越權修改另一個來源的資料。
- 人工解決模糊 identity，比錯誤自動合併更符合可信 context 的產品目標。
- No-op reconciliation 讓非 graph-impacting 的 Product Brief revision 也能留下可稽核的比較紀錄並解除 pending。

## Trade-offs

- 接受 graph reconciliation 比單純 insert 或 replace 複雜。
- 接受無法判定 identity 時，workflow 會暫停等待使用者處理。
- 接受不同 graph entity 類型需要明確的資料來源與修改範圍。

## Consequences

- Graph Draft Batch 必須記錄每項候選變更的 operation、target identity 與來源 Product Brief 版本。
- 空 changes 只允許作為明確 no-op reconciliation，且必須有 reconciliation summary。
- 每次 batch 成功套用都必須建立具有 Project-local sequence number 的 immutable Graph Revision。
- GraphNode 與 GraphEdge 必須記錄 created-in 與 last-changed Graph Revision references。
- 封存取代刪除，以保留既有 edges、handoffs 與歷史追溯。
- Batch 核准前必須驗證所有變更都在來源允許的 ownership scope 內。
- 未解決的 identity conflict 會使整個 batch 無法核准。
- Audit log 必須記錄 batch 套用的新增、更新與封存結果。
- Product Intent Reconciliation pending 期間必須阻擋 handoff；完成後必須依實際 scoped changes 判斷受影響的 Ticket Revisions。

## Ticket ownership clarification（ADR 0036）

本 ADR 的 created-in／last-changed Graph Revision 要求適用於 Product Brief 擁有的產品意圖 entities。Ticket-owned canonical nodes／edges 使用 Ticket 生命週期，不偽造 Graph Revision provenance，也不得被 Graph Draft Batch 修改。其 nullable provenance 與穩定 identity 規則見 [ADR 0036](0036-project-ticket-identity-without-product-intent-revisions.md)。
