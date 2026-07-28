# ADR 0030：由 Product Graph 掌握 Ticket Completion 權威

## Status

Accepted

## Context

AI Product Graph 未來會把內部 Tickets 匯出到 Plane、GitHub 或其他外部工具，並同步 External Work Item 的狀態。這些外部工具通常都有 closed、completed 或 done 等狀態，但它們不具備內部 Ticket Revision、Implementation Targets、Implementation Results 與 Result Acceptances 的完整語意。

若外部 closed／done 可以直接完成內部 Ticket，使用者或外部 automation 就能繞過 Result Acceptance 與 completion evidence。若完全忽略外部狀態，外部 PM 工具又無法有效支援日常進度管理。

## Options Considered

### A：外部狀態完全控制內部 Delivery Status

優點：

- 外部 PM 工具可作為唯一操作介面。
- 雙向同步模型表面上最直接。

缺點：

- 外部 closed／done 可繞過 Result Acceptance。
- 無法保證所有 required Implementation Targets 都已完成。
- 外部狀態名稱與內部 completion semantics 未必等價。

### B：外部狀態只保存，不影響任何內部進度

優點：

- 內部狀態完全不受外部工具干擾。
- 同步規則簡單且風險低。

缺點：

- 使用者在外部工具更新一般進度後仍需重複操作。
- Plane 等 PM 工具無法有效作為日常工作介面。

### C：同步一般進度，但內部保留 Completion 權威

優點：

- 外部工具可以驅動日常 `planned`、`in_progress` 與 `blocked` 進度。
- `done` 仍受內部 Result Acceptance 與 evidence 約束。
- External Work Item 與內部 Ticket 可以保留各自的狀態與來源。

缺點：

- 同步邏輯不是完全對稱。
- 需要處理外部 closed／done 與內部非 done 的差異。

## Decision

採用選項 C。

AI Product Graph 是 Ticket 規格、Result Acceptance 與內部 `done` completion semantics 的權威來源。External Work Item 是內部 Ticket 在 Plane、GitHub 或其他外部系統中的同步投影，具有獨立 identity、external status 與 lifecycle。

External Work Item 的內部 owner 依外部工具的工作範圍決定。Plane 等 product／project management item 映射到 Ticket；GitHub Issue 等 repository-specific item 映射到單一 Implementation Target。Multi-repository Ticket 因此可以有一個整體 Plane item，並為每個 target 建立各自 repository 的 GitHub Issue。

同一 internal owner 在同一 External Container 最多只能有一個 active External Work Item。External Container 以 provider、workspace／account identity 與 project／repository identity 組成。替換外部項目時必須 archive 舊 mapping 並建立新 mapping，不得改綁既有 identity。

MVP 不因 approval 或連線 External Container 自動建立第一個 work item。使用者必須明確執行首次 export；active mapping 建立後，後續 approved revisions 與適用狀態變更才自動建立 Sync Intents。

外部狀態可同步內部 Ticket 的 `planned`、`in_progress` 或 `blocked`。每次 inbound status sync 都必須記錄外部系統、External Work Item、原始狀態、映射結果、時間與 audit event。

外部 closed／done 只能更新 External Work Item 的 external status，不構成 Result Acceptance，也不得把內部 Ticket 更新為 `done`。它可以觸發待處理提示或同步差異，但不能作為 completion evidence。

只有當內部 Ticket 經有效 Result Acceptances 滿足所有 required Implementation Targets 時，才能成為 `done`。內部完成後，adapter 可以執行 outbound sync，關閉對應 External Work Items，並記錄同步結果。

若內部 Ticket 已是 `done`，但外部 work item 後來被重新開啟，adapter 必須建立不可變 Sync Conflict，保存外部與內部狀態及來源事件，不得自動降低內部 Delivery Status。使用者必須明確分類並解決：原 acceptance 當時無效則執行 Result Revocation；新需求、regression 或原範圍外工作則建立 Follow-up Ticket；外部誤操作則維持內部 `done` 並重新執行 outbound close。Resolution 必須記錄 Decision、Local Actor、時間與產生的 entity IDs。

外部 specification content 同樣不是 canonical Ticket specification。Adapter 必須先保存 immutable External Work Item Snapshot；若內容與目前 approved Ticket Revision 不同，建立 Content Drift。只有使用者選擇採用後，系統才能以最新 approved revision 為 base 建立 Ticket Revision Draft，並要求正常 approval。

Approved Ticket Revision 的 outbound content sync 必須以最後同步 snapshot 的外部 concurrency token 執行 optimistic concurrency check。只有 token 未變時才能更新 adapter-managed fields；不相等或無法驗證時建立 Content Drift 並停止。External-only 與未宣告欄位不得修改。

每個 External Work Item 的同步必須是獨立、可冪等重試的 Sync Attempt。Plane 與多個 GitHub Issues 的部分同步失敗不得回滾內部 approval，也不得撤銷其他已成功的外部同步。Sync Health 由目前應同步 revision／event 與所有 active mappings 的最新 attempts 衍生為 `current`、`pending` 或 `failed`，不影響內部 canonical statuses。

永久無法同步的 External Work Item mapping 不得 silent skip 或把 failure 改寫為 success。使用者必須修復後重試、建立 replacement，或以記錄理由的 Decision 終止並 archive mapping；只有 archived mapping 才從 Sync Health 排除。

## Rationale

- 內部 `done` 代表已具備結構化 evidence 且經使用者接受，不能由語意較弱的外部狀態取代。
- 一般進度同步仍能讓外部 PM 工具承擔它們擅長的工作流。
- 分離 internal Delivery Status 與 external status，可避免不同工具的狀態模型污染核心 domain。

## Trade-offs

- 接受 inbound 與 outbound sync 規則不完全對稱。
- 接受外部 closed／done 與內部非 done 可能暫時並存。
- 接受 adapters 必須保存狀態映射與同步 audit data。
- 接受狀態不一致時需要使用者分類，不能採 last-write-wins。

## Consequences

- External Work Item 必須保存自己的 external status，不得直接共用 Ticket Delivery Status 欄位。
- Product／project-level External Work Item 必須映射到 Ticket；repository-specific External Work Item 必須映射到單一 Implementation Target。
- 同一 internal owner 與 External Container 的 active mapping 必須唯一；replacement 必須保留 archived mapping history。
- MVP 首次 export 必須由使用者明確觸發；active mapping 才 enrollment 後續同步。
- Adapter 只能把外部一般進度映射為 `planned`、`in_progress` 或 `blocked`。
- 外部 closed／done 不得呼叫 Ticket completion operation。
- Ticket completion operation 必須只接受有效的內部 Result Acceptances。
- 內部 Ticket 成為 `done` 後，adapter 可向外同步關閉 External Work Items。
- 外部重新開啟已完成 Ticket 的 work item 時必須建立 Sync Conflict，不得自動降低內部 Delivery Status。
- Sync Conflict resolution 必須記錄使用者分類、Decision 與後續動作的 entity IDs。
- Inbound content sync 必須保存 External Work Item Snapshot；Content Drift 不得直接修改 approved specification。
- 採用外部內容必須建立新的 Ticket Revision Draft，並保存來源 snapshot 與 diff。
- Outbound content sync 必須受最後 snapshot 的 concurrency token 保護，且只能更新 adapter-managed fields。
- External Work Items 必須獨立同步並以穩定 idempotency key 重試；不得要求跨 providers 的 distributed transaction。
- Sync Health 必須由最新 attempts 衍生，且不得撤銷或阻擋已完成的 internal approval。
- 永久失敗 mapping 的 termination 必須由使用者明確決定，保留全部同步歷史，並 archive mapping 後才排除 health。
- 所有 inbound 與 outbound status sync 都必須留下來源、映射與結果的 audit record。
- Integration tests 必須涵蓋外部 closed／done 無法繞過 Result Acceptance 的案例。
