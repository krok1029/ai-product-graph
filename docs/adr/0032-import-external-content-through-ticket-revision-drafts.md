# ADR 0032：透過 Ticket Revision Drafts 匯入外部內容

## Status

Accepted

## Context

Plane、GitHub Issues 或其他 External Work Items 可能在匯出後被修改 title、description、acceptance criteria 或其他 specification content。內部 Ticket specification 則以 immutable approved Ticket Revisions 表示，並作為 Implementation Brief、Implementation Result 與完成驗收的追溯來源。

若外部內容可以直接覆蓋 approved Ticket Revision，既有 handoff 與 evidence 會失去原本依據。若完全忽略外部修改，使用者在外部 PM 工具做的有效規格修訂又無法帶回 Product Graph。

## Options Considered

### A：外部內容直接覆蓋目前 Ticket 規格

優點：

- 外部工具可作為即時規格編輯介面。
- 同步步驟最少。

缺點：

- Approved Ticket Revision 會被原地修改。
- Implementation Brief、Result 與 evidence 的歷史依據遭到破壞。
- 外部 automation 或誤操作可以繞過 approval。

### B：外部內容只保存，永遠不能匯入

優點：

- Canonical specification 完全不受外部系統影響。
- 不需要 content conflict resolution。

缺點：

- 使用者必須手動重做外部有效修改。
- 外部 PM 工具無法參與規格演進。

### C：保存 Snapshot，透過 Revision Draft 匯入

優點：

- 外部修改可被觀察、比較並選擇性採用。
- Approved specification 保持不可變。
- 匯入內容仍經 base pointer check 與人工 approval。

缺點：

- 需要 External Work Item Snapshot、Content Drift 與 resolution workflow。
- 使用者採用外部修改時多一個 draft review 步驟。

## Decision

採用選項 C。

Adapter 每次讀取 External Work Item 時，必須保存 immutable External Work Item Snapshot，包括 external item identity、內容、external status、外部版本或更新時間、擷取時間與來源。Snapshot 是外部來源紀錄，沒有 Review Status，也不是 canonical Ticket specification。

若 snapshot 的 title、description、acceptance criteria 或其他 specification content 與 internal owner 目前 approved Ticket Revision 不同，系統必須建立 immutable Content Drift。Drift detection 不得修改 Ticket、Ticket Revision 或 Implementation Target。

使用者選擇採用外部修改時，系統必須以當下最新 approved Ticket Revision 為 `base_approved_revision_id` 建立新的 Ticket Revision Draft，並保存來源 snapshot、結構化 diff 與 resolution Decision。Draft 必須通過正常 validation 與 approval；base 若在 approval 前變成 stale，依既有 optimistic concurrency 規則回傳 conflict，不得自動 rebase。

使用者選擇不採用外部內容時，系統必須記錄 Decision。Adapter 可以依後續 outbound sync 規則把 canonical content 重新同步到外部 item，但不得以忽略 drift 的方式覆蓋外部變更。

新的 Ticket Revision 核准後，outbound content sync 必須比較外部 version、ETag、updated timestamp 或 provider 提供的等價 concurrency token 與最後同步 snapshot。只有 token 仍相同時，才能更新 adapter contract 明確宣告的 managed fields，並在成功後建立新 snapshot。不相等或無法驗證時，必須建立 Content Drift 並停止覆蓋。

Labels、assignees、comments 等 external-only fields 不得由 Ticket Revision projection 修改。Adapter contract 未宣告 ownership 的欄位預設為 external-only，禁止整筆 replace External Work Item。

同步每個 External Work Item 時必須建立獨立 Sync Attempt，保存 internal source revision／event、operation、payload hash、穩定 idempotency key 與結果。Partial failure 不得撤銷 Ticket Revision approval 或其他成功同步；retry 只針對失敗目標並沿用 logical operation 的 idempotency key。

Content Drift 是否尚未處理由有無 resolution Decision 衍生，不以原地改寫 drift record 表示。

## Rationale

- Approved Ticket Revision 必須保持不可變，才能維持 handoff 與 evidence 的歷史正確性。
- Snapshot 與 diff 讓使用者能判斷外部變更，而不把外部工具提升為 canonical specification authority。
- Draft-based import 重用既有 review、approval 與 stale-base protection，不需要第二套規格核准模型。

## Trade-offs

- 接受外部修改不會立即成為 canonical specification。
- 接受每次採用外部內容都需要 Ticket Revision Draft 與 approval。
- 接受 storage 必須保留 snapshots、drifts、diffs 與 resolution decisions。
- 接受 outbound sync 在無法證明外部內容未變時會停止並要求 resolution。

## Consequences

- Domain model 必須包含 External Work Item Snapshot 與 Content Drift。
- External Work Item Snapshot 必須不可變，且不具有 Review Status。
- Inbound content sync 不得直接修改 approved Ticket Revision 或 Implementation Target specification。
- Content Drift resolution 的 adopt 路徑必須建立 Ticket Revision Draft，並引用最新 approved revision 作為 base。
- 新 draft 必須保留來源 snapshot 與結構化 diff。
- Reject／ignore resolution 必須記錄 Decision，不能刪除 snapshot 或 drift history。
- Outbound content sync 必須執行 snapshot-based optimistic concurrency check，並只更新 adapter-managed fields。
- External-only 與未宣告欄位不得被 Ticket Revision projection 覆蓋。
- 每個 External Work Item 的同步與 retry 必須獨立且冪等；partial failure 不得造成跨系統 rollback。
- Audit log 必須記錄 snapshot ingestion、drift detection、resolution、draft creation 與後續 approval。
- Integration tests 必須驗證外部內容無法繞過 Ticket Revision approval。

## 2026-09-28 補充：不可變處置關聯

以新增 Content Drift Resolution 關聯作為 drift 與 Decision 的唯一處置權威，不回寫原始 drift 的 `resolution_decision_id`。選擇此方案是為保留偵測紀錄的完整歷史；代價是讀取時必須驗證關聯並衍生公開處置資訊。舊版非空 raw pointer 若沒有有效且一致的關聯，回報 conflict，不猜測其他 Decision 的用途。

關聯及其 Decision 不可更新或刪除，一份 drift 僅能處置一次。Reject 保留有效歷史 Project／Ticket／mapping 的可處置性，不要求目前規劃來源仍新鮮。Adopt 保留產生的候選 draft 關係；後續正常 approval 或 stale archival 不改變原處置。處置不觸發遠端同步、不替代實作驗收。新增介面僅屬 full profile，保留 ADR0039–0041 的本機階層與權限邊界。
