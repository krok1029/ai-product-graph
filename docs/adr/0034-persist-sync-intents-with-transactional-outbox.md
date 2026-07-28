# ADR 0034：以 Transactional Outbox 保存 Sync Intents

## Status

Accepted

## Context

內部 approval 可能需要在 commit 後更新 Plane、GitHub 或其他 External Work Items。外部 API 可能 timeout、暫時不可用，或在本機 stdio MCP server 結束前尚未完成。

若 approval transaction 直接等待外部 API，外部 timeout 會讓呼叫端無法判斷內部 approval 是否已成立。若只把待同步工作放入記憶體 queue，process crash 或服務重啟會遺失已承諾的外部副作用。

## Options Considered

### A：Approval Transaction 內同步呼叫外部 APIs

優點：

- Approval response 可直接包含外部同步最終結果。
- 不需要額外 queue 或 processor。

缺點：

- 外部 latency 與 timeout 延長或破壞 internal transaction。
- Database commit 與外部副作用無法真正原子化。
- 呼叫端可能在 timeout 後無法判斷 approval 是否成功。

### B：Commit 後放入 In-Memory Queue

優點：

- Approval 不需要等待外部 API。
- 實作比 durable queue 簡單。

缺點：

- Process crash 或 restart 會遺失 pending work。
- Approval 可能成功，但對應同步需求沒有持久化紀錄。
- 無法可靠查詢或恢復 Sync Health。

### C：Internal Transaction 寫入 Durable Sync Intent／Outbox

優點：

- Domain state 與同步需求在同一 database transaction 提交。
- 外部 API 只在 commit 後呼叫，不影響 approval 成功語意。
- Process restart 後可恢復 pending intents。
- Intents、attempts 與 retries 都能完整稽核。

缺點：

- 需要 outbox storage、processor 與 recovery logic。
- Approval response 只能回報 `pending`，不能保證外部已立即更新。

## Decision

採用選項 C。

任何 domain operation 若產生外部副作用需求，必須在同一 internal database transaction 寫入對應的 durable Sync Intents。每個 intent 針對單一 External Work Item mapping 或尚待建立 work item 的 External Container，並固定 internal source revision／event、operation、payload hash 與 stable idempotency key。

首次 External Work Item create intent 只能由使用者明確操作產生，且必須固定 Ticket 的 current approved `source_ticket_revision_id`。Target-level create 還必須驗證 Implementation Target 屬於該 revision，且 Repository 符合 External Container。Draft 不得產生 create intent。

Internal transaction 內不得呼叫外部 API。Approval commit 後立即回傳成功；若目前必要 intents 尚未完成，response 可回傳衍生的 `sync_health: pending`。外部成功與否不得改寫或撤銷已成立的 approval。

Post-commit Sync Intent processor 在 transaction 外消費 intents，對每次 provider invocation 建立 Sync Attempt。Retry 必須沿用 logical operation 的 idempotency key，並遵守每個 External Work Item 的獨立同步規則。

Processor 必須依 External Work Item mapping sequence 序列化 intents。尚未開始的 content-update intent 可以由較新 revision 的 intent 以 `supersedes_sync_intent_id` 取代，舊 intent 仍保留；已開始的 update 必須先成為 terminal。Create、close、reopen 等 lifecycle intents 不得被 coalesce 或跳過。

Terminal-failed content update 可由較新的 content intent 取代其 retry requirement；processor 不需先重送過時 payload。Failed lifecycle intent 不得被新版內容繞過，必須作為 ordering barrier 等待成功或明確 resolution。

若 lifecycle failure 永久無法修復，processor 不得自行略過。使用者可在修復後 retry、建立 replacement，或執行 Sync Mapping Termination。Termination archive mapping 並使 pending intents 不再執行，但必須保留其原始 outcome 與 errors；archived mapping 才從目前 Sync Health 排除。

Pending intents 必須保存在 SQLite／後續 persistence store，不得只存在 process memory。Server 啟動或 integration processor 恢復時，必須重新掃描尚無成功 attempt 的 intents 並繼續處理。

Sync Health 必須從目前 source revision／event 所需 intents 與其 attempts 衍生；intent 已持久化但尚未成功時為 `pending`，最新 attempt 失敗且尚未成功 retry 時為 `failed`。

## Rationale

- Transactional outbox 能保證 internal decision 與「需要同步」的事實一起成立。
- Post-commit execution 避免外部 latency、timeout 或 outage 污染 internal transaction。
- Durable intents 讓本機 process restart 後仍可完成 eventual consistency。
- Approval 與 integration delivery 分離後，兩者的成功語意可被清楚查詢。

## Trade-offs

- 接受 approval 完成時外部投影可能仍未更新。
- 接受需要 outbox polling／processing 與 recovery mechanism。
- 接受 storage 必須保存 intents、attempts 與 idempotency metadata。

## Consequences

- Domain transaction boundary 必須包含 domain state、audit records 與 Sync Intents。
- External API calls 必須在 internal commit 後執行。
- Approval tools 不得等待所有外部同步完成才回傳成功。
- Sync Intent 必須 durable，且 server restart 後可恢復 pending work。
- First-export create intent 必須固定 current approved Ticket Revision；draft 不得建立 intent 或 mapping。
- Sync Intent processor 必須建立 Sync Attempts 並使用 stable idempotency keys。
- Sync Intent processor 必須依 mapping sequence 執行，並只 coalesce 尚未開始的 content updates。
- Processor 可略過已被新版 content intent 取代的 terminal-failed update retry，但必須保留其 attempts。
- Superseded intents 必須保留，lifecycle intents 不得省略。
- Failed lifecycle intent 必須阻擋同一 mapping 的後續處理。
- Permanent lifecycle failure 必須由使用者 Decision resolve；processor 不得自動標記成功或排除 health。
- Approval response 與 resources 必須能呈現衍生 Sync Health。
- Outbox tests 必須涵蓋 commit failure、commit 後 crash、restart recovery、duplicate processing 與 external timeout。
