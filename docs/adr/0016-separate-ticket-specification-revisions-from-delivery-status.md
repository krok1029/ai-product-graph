# ADR 0016：分離 Ticket 規格版本與 Delivery Status

## Status

Accepted

## Context

Ticket 同時承載兩種不同性質的資訊：一是 title、目標、acceptance criteria、dependencies 與產品意圖連結等工作規格；二是 planned、in progress、blocked、done 等執行進度。

如果 approved Ticket 的規格可以原地修改，已產生的 implementation handoff、External Work Item 與程式碼變更會失去當時依據。如果任何執行進度更新都必須建立新版本並重新核准，日常交付流程又會變得不必要地繁瑣。

## Options Considered

### A：Ticket 所有欄位都可原地修改

優點：

- 資料模型與操作流程最簡單。
- 規格和進度都能快速更新。

缺點：

- Approved 規格會在事後改變。
- 無法可靠追溯 implementation handoff 或程式碼變更使用的規格。
- 外部同步可能意外改寫內部產品意圖。

### B：Ticket 所有變更都建立新版本並重新核准

優點：

- 所有歷史狀態都可追溯。
- 更新規則一致。

缺點：

- 每次進度更新都需要新版本與 approval。
- 日常 delivery workflow 過度繁瑣。
- 混淆規格審查與工作進度。

### C：規格版本不可變，Delivery Status 獨立更新

優點：

- 規格變更具有清楚的 review 與 approval 歷史。
- 進度更新保持簡單。
- 同一 Ticket identity 可跨規格修訂與交付狀態維持穩定。

缺點：

- 資料模型需要分離 Ticket identity、specification revision 與 delivery state。
- Tools 與 resources 必須清楚指出正在操作哪一個層次。

## Decision

採用選項 C：Ticket 具有穩定 identity，且本身不具有 Review Status。規格內容以不可變、具有 Review Status 的 revisions 表示，Delivery Status 則作為 Ticket identity 上獨立且可變的執行狀態。

Title、目標、acceptance criteria、dependencies 或產品意圖連結的任何變更，都必須建立 Ticket Revision Draft。使用者核准後，該 draft 沿用原 Ticket identity，成為新的 approved specification revision；舊的 approved revisions 必須保留。

每個 Ticket Revision Draft 必須記錄建立時的 `base_approved_revision_id`。Approval 時若該 base 不再等於 Ticket 的 current approved revision，必須回傳 conflict，不得取代較新的 approved revision。

Delivery Status 可使用 `planned`、`in_progress`、`blocked` 或 `done`，並可在不重新核准規格的情況下更新。規格的 Review Status（draft／approved）與 Lifecycle Status（active／archived）不得被用來表示工作進度。

Delivery Status 是相對於 current approved Ticket Revision 的執行進度。任何 replacement Ticket Revision 核准時都必須原子重設為 `planned`，即使舊狀態是 `in_progress`、`blocked` 或 `done`。舊 handoffs、results 與 acceptances 保留歷史，但不支撐新 revision 的 delivery state。

`done` 不是可任意切換的進度值，必須持續由有效的 Result Acceptances 支撐。若使用者發現某項 acceptance 在作成當時即無效，可在 Ticket 完成前或完成後執行明確的 Result Revocation，並 archive 對應 approved Result；Ticket 若已是 `done`，必須退回 `in_progress` 或 `blocked`，尚未完成則保留原 Delivery Status。新需求、後續 regression 或原 acceptance criteria 未涵蓋的工作則建立可追溯到原 Ticket 的 Follow-up Ticket，不 reopen 原 Ticket。

External Work Item 的一般進度可同步內部 `planned`、`in_progress` 或 `blocked`，但外部 closed／done 不是 Result Acceptance，只能更新 External Work Item 自己的狀態。內部 Ticket 完成後可向外同步關閉 work item。

外部 title、description、acceptance criteria 或其他規格內容不得直接修改 approved Ticket Revision。Adapter 必須保存 immutable External Work Item Snapshot 並建立 Content Drift；使用者選擇採用時，以最新 approved revision 為 base 建立新的 Ticket Revision Draft，再走正常 approval。

## Rationale

- 規格變更會影響「要做什麼」，需要 review gate 與歷史追溯。
- Delivery Status 只表示「目前做到哪裡」，不應觸發產品意圖重新核准。
- 穩定 Ticket identity 可讓 graph edges、External Work Items 與歷史 artifacts 持續指向同一工作單位。

## Trade-offs

- 接受 Ticket storage 與 API 比單一可變 record 複雜。
- 接受使用者修改 approved 規格時必須經過 revision workflow。
- 接受 Review Status、Lifecycle Status 與 Delivery Status 需要分開顯示及查詢。

## Consequences

- Ticket identity、Ticket specification revisions 與 Delivery Status 必須分開建模。
- Implementation handoffs 必須引用特定 approved Ticket revision，而不只引用 Ticket identity。
- 更新 Delivery Status 不得修改或取代 approved specification revision。
- 修改 approved Ticket 規格的操作必須被拒絕，改由建立 Ticket Revision Draft 處理。
- Ticket Revision approval 必須以 `base_approved_revision_id` 執行 optimistic concurrency check。
- Replacement Ticket Revision approval 必須把 Delivery Status 重設為 `planned`，並留下 status change audit record。
- Audit log 必須區分 specification approval 與 Delivery Status change。
- Audit log 必須記錄 Result Revocation，以及實際發生時的 Delivery Status rollback。
- Follow-up Ticket 必須以 `traces_to` 關係連回原 Ticket。
- 外部 closed／done 不得直接更新內部 Ticket 為 `done`；所有 status sync 必須記錄來源與 audit event。
- 外部 specification content 不得直接改寫 approved Ticket Revision；採用內容必須建立可追溯來源 snapshot 的新 draft。
