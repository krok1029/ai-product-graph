# Ordered Mapping Sync Plan

`get_mapping_sync_plan({ mapping_id })` 與 `product-graph://external-work-item-mappings/{mappingId}/sync-plan` 提供同一份唯讀觀測。`mapping_id` 必須是非空字串，額外 tool 欄位會被拒絕。

Plan 只說明目前 SQLite snapshot 中的同步順序，不代表已取得 execution claim。`ready` 或 `retry_required` 也不授權外部寫入；未來執行仍須原子重新檢查資格、取得 per-mapping fence，並滿足 provider concurrency 規則。查詢不建立 attempts、不重試、不終止 lease、不呼叫 provider，也不改寫 receipts。

| state | 意義 | next_intent |
| --- | --- | --- |
| `inactive` | Mapping 已 archived；只有有效 stored termination 才提供 `termination_id` | null |
| `invalid_history` | Provenance、sequence、supersession 或目前 desired 義務不完整 | null |
| `waiting_for_attempt` | 第一個必要 mapped intent 的 attempt 尚在 started | null |
| `retry_required` | 第一個必要 mapped intent 已 failed，仍阻擋後續工作 | 同一個失敗 intent |
| `ready` | 第一個必要 mapped intent 尚未開始 | 該 intent |
| `idle` | 所有 mapped 義務都已成功或由共用分類明確解除 | null |

Response 固定含 `mapping_id`、`included`、`state`、`next_intent`、`blocking_intent_ids`、`entries`、`reasons`、`termination_id`。Intent identity 為 `id`、`sequence_number`、`operation`、`source_ticket_revision_id`。原始 create 的 sequence 為 null，僅作為 mapping 成立的成功證明，不是 mapped execution candidate。Entries 依原始 create、mapped sequence／ID 排序。

每個 entry 額外保存 `disposition`（`required`、`fulfilled`、`superseded_unstarted`、`obsolete_failed_content`）、`attempt_state`（`unstarted`、`started`、`failed`、`succeeded`）及原始查詢的 `request_state`。因此保留的 pending historical row 可以同時是已 superseded；不必改寫其 outcome。`reasons` 使用 `{ code, intent_id? }`，`blocking_intent_ids` 指出尚在執行或必須重試的第一個 intent。

Plan 與 Sync Health 共用 `classifyMappingSyncObligations`，不另寫 supersession policy。有效歷史 supersession edge 的效力不會因 replacement 開始或再有新版而消失。已開始的 content 必須先 terminal；terminal-failed 舊 content 可被最新 desired content 取代，但不能越過尚未完成的 close／reopen。任何成功 attempt 可證明其 intent 已 fulfilled。

Missing create／snapshot proof、sequence gaps、invalid pointer、invalid current approved revision、missing current content／close／reopen 都不會提供 candidate。Unknown mapping 回傳 `NOT_FOUND`。Known damaged history 回 `invalid_history`；若 mapping 已 archived，仍優先回 `inactive` 並保留可取得的 diagnostics，不能因此宣稱 damaged history 有效。一般 archive 不會被推測成 termination Decision。Active mapping 即使 external item 已 archived，仍須參與 ordered work。

整份查詢在同一 transaction snapshot 讀取 mapping、Ticket、current revision、完整 intent／attempt history 與 termination。Repeated reads 與 process restart 不新增 audit、actor、claim、attempt、intent 或 receipt，也不更動既有 failure、termination 或 domain state。
