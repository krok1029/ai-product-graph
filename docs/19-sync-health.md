# Mapping Sync Health

`get_mapping_sync_health({ mapping_id })` 只讀取 SQLite 中的 Ticket、mapping、Sync Intents 與 attempts，在同一 transaction snapshot 衍生 health。它不呼叫 Plane，不 claim、expire 或 retry attempt，不建立 intents，也不改變已核准的規格、Delivery Status 或 operation receipts。`current` 僅表示已知的同步義務已履行，不表示已檢查 provider 上的 Content Drift。

## 回傳

- `sync_health`：`current`、`pending` 或 `failed`，優先順序為 failed > pending > current。
- `included`：mapping 是否仍 active；archived mapping 回傳 false，從目前 health 排除。
- `required_intent_ids`：計算中仍必要的 intents，包含已成功履行者。
- `ignored_content_intent_ids`：依下述內容取代規則排除的歷史 updates。原始 request state、attempts 與 payload 不變。
- `reasons`：穩定 `code`，相關時另有 `intent_id`。若 history 不足以安全解釋，回傳 pending 診斷；請用 `list_mapping_sync_intents` 查詢原始 history 或其驗證錯誤。

任何 succeeded attempt 都履行該 intent。沒有成功時，latest failed 為 failed；沒有 attempt 或 latest started 為 pending。過去 failed 後的 started retry 為 pending；intent lifecycle 為 archived 不會解除 active mapping 的義務。External Work Item、Ticket 或 Project archive 也不等同於 mapping termination。

## 必要義務

原始 create proof 與所有已記錄的 create、close、reopen 都必須履行。失敗的 close 不會因新版內容或成功 reopen 而消失。此階段尚無 termination decision 可以解除 active mapping 的 lifecycle barrier。

Desired content 使用目前 approved Ticket Revision 的最高 sequence 有效 full-content update；只有原始 create 的 pinned revision 仍等於 current approved revision 時，create 才能提供內容 baseline。Close/reopen 搭載目前 revision ID 不能證明內容已同步。找不到目前 revision 的內容 intent 時，回傳 `missing_current_content_intent`。

Done Ticket 必須有最後一筆 close；create 本身不代表 close。非 done Ticket 以 create 為初始 planned baseline，但若最後記錄的 status intent 是 close，仍缺少後續 reopen。這些缺口分別回報 `missing_close_intent` 或 `missing_reopen_intent`，讀取不會製造補償 intent。

舊 content update 的處理：

- 已成功者已履行。
- Terminal-failed update 可由較新的有效 desired full-content update 取代 retry requirement，即使沒有 supersedes pointer。
- 從未開始的 update 必須有從 desired update 回溯的有效 `supersedes_sync_intent_id` chain 才能排除。現有 enrollment 的 null pointer 不會被讀取端自行補上。
- Latest attempt 仍 started 的 update 保留 pending，直到它成為 terminal。
- Chain 必須同 mapping、sequence 向後、兩端皆 update，且不能跨 create/close/reopen。無效、循環或反向 chain 不解除 pending 義務。

## Reason codes

| Code | 意義 |
| --- | --- |
| `obligations_fulfilled` | 所有目前必要且有效的義務已履行 |
| `intent_pending` | 必要 intent 尚未完成，含正在 retry |
| `intent_failed` | 必要 intent 的 latest attempt 已失敗且尚無成功 attempt |
| `obsolete_failed_content` | 舊 terminal-failed content 已由較新 desired content 取代 |
| `superseded_unstarted_content` | 舊未開始 content 經有效明確 chain 排除 |
| `missing_current_content_intent` | 缺少 current approved revision 的內容義務 |
| `missing_close_intent` | Done Ticket 缺少最後一筆 close |
| `missing_reopen_intent` | 非 done Ticket 在 close 後缺少 reopen |
| `invalid_supersession` | Supersession link 無法安全解除義務 |
| `invalid_obligation` | Pure evaluator 的 intent、payload、hash、sequence 或 attempt identity 無效 |
| `incomplete_history` | Mapping provenance、original create proof 或完整 history 無法驗證 |
| `mapping_archived` | Mapping 已封存，`included: false` |

真正不存在的 mapping 回傳 `NOT_FOUND`；已存在但損壞的 history 不會被誤報為 current。Health 是目前觀測，不應寫入不可變 Operation Receipt。Acceptance 或 Revocation 之後需使用 read API 查詢，不改寫它們的歷史 response。
