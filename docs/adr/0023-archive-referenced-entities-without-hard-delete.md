# ADR 0023：Canonical 或已引用的 Entity 只能 Archive

## Status

Accepted

## Context

Product Brief、graph nodes、tickets、Implementation Briefs 與 evidence 會形成跨版本的追溯鏈。這些實體一旦成為 canonical，或被 edges、handoffs、results、decisions 與 audit records 引用，永久刪除就會使歷史關係斷裂。

Entity 退出目前產品範圍後，系統仍需要把它排除於新的 generation 與 handoff，同時保留過去決策與實作所依據的資料。若 archive 之後可以直接切回 approved，又會繞過目前適用的 draft、review 與 reconciliation 規則。

## Options Considered

### A：允許 Hard Delete

優點：

- 儲存空間與 active dataset 最小。
- 使用者可以完全移除不需要的內容。

缺點：

- 歷史 edges 與 artifacts 可能失去參照目標。
- Audit log 無法重建過去狀態。
- Ticket、handoff 與 code evidence 的追溯鏈可能中斷。

### B：Archive，並允許直接恢復 Approved

優點：

- 保留歷史資料。
- 重新啟用操作快速。

缺點：

- 舊內容可能在未重新審查下回到 active scope。
- 可能繞過 Product Brief version、Graph Draft Batch 或 Ticket revision 規則。

### C：Archive，重新啟用必須經過新 Draft 或 Change Batch

優點：

- 保留 identity、版本與完整追溯。
- Archived content 不會參與新的 generation 或 handoff。
- 重新啟用時會依照目前產品意圖重新審查。

缺點：

- 歷史資料會持續占用儲存空間。
- 重新啟用需要額外 draft 與 approval 流程。

## Decision

採用選項 C：任何曾經 canonical 或已被其他資料引用的 entity 都不得 hard delete，只能 archive。

Archived Entity 退出目前有效範圍，不參與新的 graph extraction、ticket generation 或 implementation handoff。它的既有 edges、versions、decisions、results 與 audit records 必須保留，供歷史查詢與追溯。

Archived Entity 不得直接切回 approved。若同一概念需要重新進入 active scope，必須建立新的 draft revision 或 Graph Draft Batch change，經適用的 validation 與 approval 後生效；原本的 archive 事件與歷史版本仍保留。

## Rationale

- 可追溯性依賴 entity identity 與歷史參照長期存在。
- Archive 能把 active product scope 與 historical record 分開。
- 重新啟用走現行 review workflow，可避免過時內容未經檢查重新生效。

## Trade-offs

- 接受 canonical history 的儲存量只增不減。
- 接受重新啟用比直接切換狀態更繁瑣。
- 接受所有 active queries 與 generation workflows 都必須明確排除 archived entities。

## Consequences

- Storage schema 與 foreign keys 不得對 canonical 或 referenced entities 執行 destructive cascade delete。
- Resources 必須能區分 active 與 archived views，並保留歷史查詢能力。
- Generation 與 handoff validation 必須拒絕 archived source entities。
- Reactivation tools 必須建立新 draft revision 或 change batch，不得直接更新為 approved。
- Audit log 必須記錄 archive 與後續 reactivation decision。
