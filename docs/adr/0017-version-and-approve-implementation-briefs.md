# ADR 0017：Implementation Brief 必須版本化並核准

## Status

Accepted

## Context

Implementation Brief 是 AI Product Graph 與 coding agent 之間的交接產物。它會整合 approved Ticket revision、Product Brief 版本與 client 提供的 repository context，讓 coding agent 擬定或執行程式碼變更。

如果 Implementation Brief 每次讀取時即時重組，或在來源改變後悄悄更新，同一個 brief identity 可能在不同時間代表不同指示。這會使程式碼變更無法追溯到 coding agent 當時實際收到的產品與 repository context。

## Options Considered

### A：每次讀取時即時組合

優點：

- 永遠使用目前可取得的資料。
- 不需要保存獨立 artifact。

缺點：

- 相同請求可能在不同時間產生不同內容。
- 無法重建 coding agent 當時收到的指示。
- 來源變更可能在未審查下改變 handoff。

### B：保存可原地更新的 Implementation Brief

優點：

- 可以保留 artifact identity。
- 修正內容時操作簡單。

缺點：

- 舊的實作與 PR 會失去當時使用的 brief 內容。
- Approved 與未審查修改之間沒有可靠邊界。

### C：保存不可變、可版本化且需核准的 Implementation Brief

優點：

- 每次 handoff 都能追溯到精確內容與來源版本。
- 使用者可在 coding agent 執行前審查 AI 產生的實作脈絡。
- 來源變更不會悄悄改寫既有 handoff。

缺點：

- 必須保存 brief versions 與 repository context snapshots。
- 來源改變時需要重新產生及核准新版。

## Decision

採用選項 C：Implementation Brief 是不可變、可追溯的 handoff artifact。每份 brief 本身具有獨立 identity、Review Status 與 Lifecycle Status，不另建立 aggregate + version 雙層 identity。

每個 Implementation Brief 必須綁定特定 approved Ticket Revision 的 Implementation Target、Product Brief Version 與該 target Repository 的 Repository Context Snapshot。單一 brief 不得跨 Repositories。AI 產生的 Implementation Brief 一律先是 draft；只有使用者明確核准的 artifact，才可以交給 coding agent 作為實作輸入。

綁定的 Product Brief Version 表示 brief 生成時的 provenance，不要求在 handoff 時仍是 current pointer。Freshness 由 current Ticket Revision、其 referenced intent nodes 是否自 source Graph Revision 後變更、dependencies 與 repository state 判定，避免無關 Product Brief 修改全面失效 handoffs。

但新版 Product Brief 已核准、對應 graph reconciliation 尚未核准時，系統尚不能證明 referenced nodes 未受影響，因此所有 handoff 暫時阻擋。Reconciliation 完成後，未受實際 graph changes 影響的 brief 可繼續使用。

Approved Implementation Brief 不得原地修改。任何來源規格、產品意圖、repository context 或 brief 內容改變時，都必須建立具有新 identity 的 draft 並重新核准；新 artifact 可以用 `supersedes_implementation_brief_id` 指向被取代的 brief。舊 artifacts 必須保留，供既有 code changes、pull requests 與 audit records 追溯。

同一 Implementation Target 最多只能有一份 active approved Implementation Brief。核准替代 brief 時，必須明確 supersede 並 archive 先前 active approved brief；核准與 archive 必須原子完成。不同 targets 可以各自保有一份 active approved brief。

Replacement Ticket Revision approval 必須以 `source_revision_superseded` archive 綁定舊 revision 的所有 active briefs，包括 draft 與 approved artifacts。Review Status 與歷史 links 保留。新 revision 的 brief 可用 `supersedes_implementation_brief_id` 指向最近的 archived approved predecessor 作為 lineage，但不得 re-activate 它。

## Rationale

- Coding handoff 需要穩定且可重現的輸入契約。
- 明確 approval 可避免 AI 產生的錯誤計畫直接進入實作。
- 固定來源版本可回答某個程式碼變更是依據哪一版產品意圖、Ticket 規格與 repository context。

## Trade-offs

- 接受 implementation workflow 多一個 review / approve step。
- 接受保存 Repository Context Snapshots 與 brief versions 的儲存成本。
- 接受來源更新後，舊 brief 可能仍存在但不再適合新的實作。

## Consequences

- Implementation Brief 必須具有獨立穩定識別、draft／approved Review Status 與 active／archived Lifecycle Status。
- Implementation Brief 不建立 aggregate；替代關係使用 `supersedes_implementation_brief_id`。
- Approval 必須強制同一 Implementation Target 的 active approved brief 唯一性。
- Replacement Ticket Revision approval 必須 archive 舊 revision 的 active briefs，並保留 Review Status 與 audit history。
- Supersedes link 可以指向 archived predecessor 表示 lineage，不代表 reactivation。
- Brief 必須保存其來源 Ticket revision、Product Brief version 與 Repository Context Snapshot references。
- Product Brief version reference 是 provenance；不得僅因 current pointer 改變就判定 brief stale。
- Coding agent handoff tools 只能輸出 approved Implementation Brief。
- Code changes 與 pull requests 應記錄其實際使用的 Implementation Brief version。
- 系統不得因來源更新而改寫既有 approved brief，必須建立新版。
