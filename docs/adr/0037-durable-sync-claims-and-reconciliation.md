# ADR 0037：Durable Sync Claim 與不確定結果的 Reconciliation

## Status

Accepted

## Context

ADR 0033／0034 的 durable Sync Intent 只能證明工作已排入；多個 processor、執行中 crash，以及 provider 成功後本機 commit 失敗，仍可能造成重複建立。Sync Intent 的 immutable payload 不能拿來保存 worker 協調狀態，也不能宣稱跨 SQLite 與 provider 的 exactly-once。

## Options Considered

- 記憶體鎖：簡單，但 restart 後失效，也不能保護不同 connections。
- 永久 started attempt 鎖：避免重複，但 crash 後無法恢復。
- Durable lease 與 token fence：可恢復且可驗證；額外保留 coordination history，並要求 provider reconciliation。

## Decision

採 durable lease 與 token fence。`sync_intent_claims` 是 execution coordination table，不是新的 domain status，也不修改 Sync Intent。每次 claim 保存獨立 token、worker、attempt、UTC 開始／到期時間與 invocation stage。Token 永遠不可重用；每個 intent 最多一筆尚未釋放的 claim。

Claim 以 SQLite `BEGIN IMMEDIATE` 串行化競爭，原子建立 started Sync Attempt 與 audit。Claim 只接受 active Plane manual create intent；已成功、其他 operation、錯誤 owner／container／payload hash 一律拒絕。Attempt 沿用 intent 的 operation 與 stable idempotency key。UTC 時間固定到毫秒，不接受無 timezone 或非 canonical 格式；同時刻 attempts 以 durable claim sequence 排序，無 claim 的舊 history 保留 ID tie-break。

有效 token 只能在 `claimed_at <= now < expires_at` 使用；invocation 之後的時鐘不得倒退。到期接手時，舊 started attempt 變為 failed，保存 `INTERRUPTED`、`invocation_started` 與 `outcome_uncertain`，再建立新 attempt。Recovery 與 audit 若失敗全部 rollback，舊 worker 不得提交任何後續 outcome。

Provider invocation 前必須先提交 `markInvoking`，每 attempt 最多一次。Claim 不需要 reconciliation 時記錄 `create`，需要時記錄 `reconcile`，並在呼叫前把不確定性設為 true。Crash 可能發生在記錄後、真正送出前，因此保守地仍要求 reconciliation。沒有 coordination history 的既有 attempts 亦採保守 recovery。

不確定性從前一個 claim 傳到下一個；一般 failure、尚未 invocation 的後續 crash 或 error payload 都不能清除。只有持有有效 token 的 `completeReconciledAbsent`，且該 attempt 已記錄 reconciliation invocation，才可保存 terminal failed `RECONCILED_ABSENT` 與 provider response，解除下一次 claim 的 reconciliation requirement。它的使用前提是 provider 確认 item 不存在，且保證舊請求不會延遲生效。下一次 claim 才可 create；不在同一 attempt 連續執行 reconcile 與 create。

Success 與 reconciled-absent 僅提供 processor persistence ports，要求已存在 application transaction，沒有獨立 application／MCP success mutation。Success port 驗證 matching item、active mapping、pinned revision 與 snapshot 已存在，再以目前有效 token 原子保存 outcome、release 與 audit。Processor 負責在同一 transaction 建立上述 artifacts、trace 關係及 audit。失敗 completion 不修改 Ticket、approval 或 intent。

## Trade-offs

- Token fence 只保護本機 outcome commit，無法取消舊 provider request。
- 必須注入具可靠 reconciliation 的 provider port；`unknown` 只能保留 failure，不得盲目重送。
- Coordination history 增加 storage，但可保留 worker／crash 判斷與 token 不重用保證。
- 正整數 lease duration 由執行端選擇；本階段不提供 heartbeat 延長、排程器或 live Plane credential wiring。

## Consequences

`SyncAttemptClaims` application API 提供 claim、mark-invoking 與 failure，clock／token／ID 可注入。Production 不會因建立 ports 自動執行 provider。雙 connections、expiry fencing、reopen、audit rollback、固定時鐘及不確定性繼承以真實 SQLite 測試。
