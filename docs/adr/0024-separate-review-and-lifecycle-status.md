# ADR 0024：分離 Review Status 與 Lifecycle Status

## Status

Accepted

## Context

早期 MCP tool spec 使用單一 `EntityStatus = draft | approved | archived`。這把兩個不同問題混在一起：內容是否經過人類審查，以及 entity 是否仍在目前有效範圍。

這個共用型別也無法正確描述 Idea Record、Feedback Record 與 Observed Evidence。這些來源紀錄可以直接成為 canonical data，但沒有「待核准／已核准」的語意；它們仍需要 active／archived lifecycle。Ticket 另外具有 Delivery Status，Implementation Brief 另有 Handoff Freshness，繼續擴充單一 status 只會讓狀態組合越來越模糊。

## Options Considered

### A：所有 Entities 共用單一 Status Enum

優點：

- Schema、API 與查詢欄位最少。
- 所有 entities 看起來具有一致 lifecycle。

缺點：

- `approved` 與 `archived` 表達不同維度。
- Source records 被迫具有不適用的 approval state。
- 無法清楚組合 review、lifecycle、delivery 與 freshness。
- 狀態轉移規則容易產生無效或矛盾組合。

### B：分離 Review Status 與 Lifecycle Status

優點：

- 每個狀態軸只回答一個領域問題。
- Source records 不需要虛假的 approval state。
- Reviewable artifacts 可以同時表達 approved 且 archived。
- Delivery Status 與 Handoff Freshness 可維持獨立語意。

缺點：

- Schema、tools 與查詢需要處理多個欄位。
- 既有 `status` contract 必須遷移。

## Decision

採用選項 B，移除共用 `EntityStatus`，改用兩個正交狀態：

- `ReviewStatus = draft | approved`：只存在於需要人類審查的內容，例如 Product Brief Version、AI interpretations、Graph Draft Batch、Ticket revisions 與 Implementation Brief。
- `LifecycleStatus = active | archived`：適用所有 entities，表示是否仍在目前有效範圍。

Idea Record、Feedback Record 與 Observed Evidence 沒有 Review Status；它們成為 canonical source records 不代表已被 approved。

Delivery Status 與 Handoff Freshness 都是額外、獨立的狀態軸，不得合併進 Review Status 或 Lifecycle Status。

## Rationale

- Review、retention、delivery 與 runtime validity 是不同的領域概念。
- 正交狀態可以避免單一 enum 出現大量不適用或矛盾的值。
- Source record 是否被保存，與產品意圖是否被核准必須保持清楚區分。

## Trade-offs

- 接受 persistence schema 與 MCP contract 增加欄位。
- 接受 queries 必須明確選擇 review 與 lifecycle filters。
- 接受舊文件與未來 migration 需要從 `status` 轉換成具名狀態軸。

## Consequences

- MCP schemas 不得再暴露語意不明的通用 `status` 欄位。
- Reviewable entities 使用 `review_status` 與 `lifecycle_status`；其他 entities 只使用適用的狀態欄位。
- Active canonical queries 應明確要求 `lifecycle_status = active`，並在需要時另外限制 `review_status = approved`。
- Archive 不會改變 Review Status；approved artifact 可以成為 archived approved history。
- Storage migrations、domain models、resources 與 exports 必須使用相同的狀態軸命名。
