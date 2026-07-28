# ADR 0027：以 Base Pointer 保護 Version Approval

## Status

Accepted

## Context

Product Brief 與 Ticket 都採用穩定 aggregate identity 加不可變 revisions。多個 drafts 可能基於同一個 current approved version 平行建立；其中一個先被核准後，其他 drafts 的基礎就已過時。

如果 stale draft 仍能核准，較早建立的內容可能意外取代較新的產品決策或 Ticket 規格。只依賴 version number 或建立時間不能證明 draft 是基於哪一個 approved state 產生。

## Options Considered

### A：Approval 時永遠更新 Current Pointer

優點：

- Version workflow 最簡單。
- 任何 draft 都能隨時核准。

缺點：

- 舊 draft 可能覆蓋較新的 approved decision。
- Approval 順序取代了明確的 revision lineage。

### B：Server 嘗試自動 Merge Stale Draft

優點：

- 可以保留平行 drafts 的內容。
- 減少手動重新建立 revision。

缺點：

- Product Brief 與 Ticket specification 的語意 merge 難以可靠自動化。
- 核准內容可能不同於使用者實際審查的 draft。
- 顯著增加 MVP 複雜度。

### C：Draft 保存 Base Pointer，Mismatch 時拒絕 Approval

優點：

- 防止 stale draft 取代新決策。
- Revision lineage 明確。
- Product Brief 與 Ticket 可使用一致規則。

缺點：

- Stale drafts 必須重新建立或人工搬移內容。
- 平行 drafts 中只有第一個成功核准，其餘會衝突。

## Decision

採用選項 C。

每個 Product Brief Version draft 必須保存建立時的 `base_approved_version_id`。Approval 時，該值必須仍等於 Product Brief aggregate 的 `current_approved_version_id`。

每個 Ticket Revision draft 必須保存建立時的 `base_approved_revision_id`。Approval 時，該值必須仍等於 Ticket aggregate 的 `current_approved_revision_id`。

第一個 version 或 revision 使用 `null` base，只有 aggregate current approved pointer 同樣為 `null` 時才能核准。

Base mismatch 必須回傳 `CONFLICT`，不得自動 merge、rebase 或更新 current pointer。若要保留 stale draft 的內容，使用者必須建立以目前 approved pointer 為 base 的新 draft。

Version 或 revision 成功核准並更新 current pointer 後，其他仍 active、且 base 因此不再 current 的 sibling drafts 必須在同一 transaction 自動 archive。Approval result 與 audit log 必須列出被 archive 的 draft IDs。

## Rationale

- Base pointer 明確表達 draft 所依據的 approved state。
- Compare-and-swap approval 可以低成本防止 lost decision updates。
- 相同規則適用 Product Brief 與 Ticket，降低 domain 與 tool contract 差異。

## Trade-offs

- 接受 stale drafts 無法直接核准。
- 接受平行規劃工作需要顯式 reconciliation。
- 延後自動 semantic merge tooling。

## Consequences

- Product Brief Version schema 必須包含 immutable `base_approved_version_id`。
- Ticket Revision schema 必須包含 immutable `base_approved_revision_id`。
- Create-draft tools 必須要求或解析目前 base pointer。
- Approval tools 必須在更新 current pointer的同一 transaction 中執行 compare-and-swap。
- Conflict response 必須包含 expected base 與目前 approved pointer。
- Stale approval 失敗時不得改變 Review Status、Lifecycle Status 或 current pointer。
- Successful approval 必須原子 archive stale sibling drafts。
