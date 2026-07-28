# ADR 0033：獨立且冪等地同步 External Work Items

## Status

Accepted

## Context

一項內部 approval 可能需要同步多個外部目標，例如一個 Ticket-level Plane work item，以及每個 Implementation Target 各自的 GitHub Issue。這些 providers 不共享 transaction，也可能各自發生 timeout、rate limit、權限錯誤或短暫不可用。

若把所有外部同步視為單一原子操作，任一目標失敗都沒有可靠方式回滾其他 providers 已完成的寫入。若因外部失敗撤銷內部 approval，則外部可用性會破壞已成立的 canonical domain decision。

## Options Considered

### A：模擬跨 Providers 的原子 Transaction

優點：

- 所有外部項目表面上維持一致成功或失敗。
- 呼叫端只需處理單一結果。

缺點：

- 外部 APIs 不支援共同 transaction。
- Compensation 可能失敗，無法保證真正 rollback。
- 已建立、更新或關閉的外部項目可能留下不可逆副作用。

### B：任何外部失敗都撤銷內部 Approval

優點：

- 內外狀態看似一起提交。
- 使用者不會看到 approved 但尚未完全同步的狀態。

缺點：

- 外部服務可用性成為內部 canonical approval 的必要條件。
- 已成功的外部寫入仍無法可靠撤銷。
- Approval history 與使用者已作成的決策會被技術錯誤改寫。

### C：每個 External Work Item 獨立且冪等同步

優點：

- Partial failure 可局部重試。
- 內部 approval 與已成功同步不受其他目標失敗影響。
- 每個外部副作用都有獨立 audit 與錯誤資訊。

缺點：

- 外部項目可能暫時處於不同步狀態。
- 需要持久化 attempts、idempotency keys、retry 與衍生 health。

## Decision

採用選項 C。

每個 External Work Item 必須具有獨立的 Sync Attempt。Attempt 必須保存 internal source revision／event、External Work Item、operation type、payload hash、穩定 idempotency key、開始與完成時間、結果及錯誤。

需要外部副作用的 domain transaction 必須在同一 internal database transaction 寫入每個目標的 durable Sync Intent。Intent 固定 internal source revision／event、target mapping 或 External Container、operation、payload hash 與 stable idempotency key。Transaction 內不得呼叫外部 API。

Approval commit 後應立即回傳成功；若存在尚未完成的 intents，回傳衍生的 `sync_health: pending`。Post-commit processor 消費 intents 並建立 Sync Attempts。Pending intents 不得只存在記憶體，服務重啟後必須能恢復處理。

同一 External Work Item mapping 的 intents 必須具有單調 sequence 並序列化處理。若較舊 content-update intent 尚未開始，較新的 update intent 可以用 `supersedes_sync_intent_id` 指向它，只送出最新 desired content；舊 intent 保留為 immutable history。較舊 update 已開始時，新 intent 必須等待它成為 terminal。Create、close、reopen 等 lifecycle intents 不得被 content coalescing 省略。

若較舊 content update 成為 terminal failure，較新的 content intent 可直接取代其 retry requirement，不需先重試過時內容。舊 failure 與 attempts 必須保留，但不再影響最新 desired revision 的 Sync Health。Failed lifecycle intent 則形成 per-mapping ordering barrier，後續 intents 必須等待它成功或被明確解決。

Failed lifecycle intent 永久無法完成時不得 silent skip。使用者必須選擇修復後重試、成功建立 replacement 後切換 mapping，或執行 Sync Mapping Termination。Termination 必須記錄 Decision、理由、actor 與時間，archive mapping，並保留所有 intents、attempts 與 errors；failure 不得被改寫成 success。Archived mapping 才從 Sync Health 排除。

同一 logical sync operation 的 retry 必須沿用穩定 idempotency key，以避免 timeout 後重試造成重複建立或重複套用外部變更。每次執行結果都必須保留，不得覆蓋先前失敗紀錄。

Partial failure 不得撤銷 Product Brief、Graph Draft Batch、Ticket Revision、Implementation Brief、Implementation Result 或其他內部 approval，也不得回滾其他 External Work Items 已成功的同步。Retry 只針對 pending 或 failed targets。

Sync Health 是 internal owner 相對於目前應同步 revision／event，在所有 active External Work Items 上的衍生值：

- `current`：目前最新 content intent 與所有必要 lifecycle intents 都已有對應的成功 attempt。
- `pending`：至少一個必要 intent 尚無完成 attempt，且沒有目前未解決的 failed intent。
- `failed`：至少一個必要 intent 的最新 attempt 失敗，且尚未由成功 retry 取代。

已被較新 content intent supersede 的舊 update 不影響目前 Sync Health。

Sync Health 不可手動設定，也不得改變內部 Review Status、Lifecycle Status、Delivery Status 或既有 approval。

## Rationale

- 外部 providers 無法提供可信的共同 transaction boundary。
- Internal approval 是 domain decision，不應被暫時的 integration failure 撤銷。
- Per-target idempotency 與 retry 能把失敗限制在實際受影響的 mapping。
- Transactional outbox 確保 approval 與外部同步需求不會只成功其中一半。
- 衍生 Sync Health 可以呈現 eventual consistency，而不新增可任意修改的 canonical status。

## Trade-offs

- 接受外部投影可能暫時只有部分更新。
- 接受 storage 與 operations 需要追蹤 attempts、errors 與 retries。
- 接受使用者可能看到 internal state 已核准，但 Sync Health 仍是 `pending` 或 `failed`。

## Consequences

- Domain model 必須包含 Sync Attempt，且能保存每次執行結果。
- Domain model 必須包含 durable Sync Intent；approval 與 intents 必須在同一 internal transaction 提交。
- External API calls 必須在 internal transaction commit 後執行。
- Approval response 不等待外部同步完成，並可回傳 `sync_health: pending`。
- Pending intents 必須能在 process restart 後恢復。
- 每個 logical external operation 必須具有穩定 idempotency key。
- 同一 mapping 的 intents 必須具有 per-mapping sequence 並序列化執行。
- Pending content updates 可由新版 intent supersede；supersession 必須保留舊 intent history。
- Terminal-failed content update 可由新版 content intent 取代，不必先重試舊內容。
- Lifecycle intents 不得由 content coalescing 省略或重排。
- Failed lifecycle intent 必須阻擋同一 mapping 的後續 intents。
- 永久失敗 mapping 只能經使用者 Decision terminate；archive 前不得排除 Sync Health。
- Termination 不得修改 historical attempt outcome，且必須保留 pending／failed intent history。
- Adapter create、update、close 與 reopen operations 都必須安全處理重複呼叫。
- Retry 必須以 External Work Item 為單位，不得重送所有已成功 targets。
- Internal transaction commit 不得依賴所有外部 calls 成功。
- Sync Health 必須從目前 source revision／event 與 latest attempts 衍生，不得持久化為可手動修改的 domain status。
- Audit log 必須保存 attempt、retry、success、failure 與 external response identity。
- Integration tests 必須涵蓋 timeout 後重試、partial success、duplicate delivery 與 provider failure。
