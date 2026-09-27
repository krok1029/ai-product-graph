# Plane observation capture

`PlaneObservationWorkflow(ports, provider, managedContent, options?)` 提供明確的 `observe(mappingId)`。
呼叫端注入 known-item read provider 與純同步 managed-content comparator；建構物件不會連線，MCP stdio 啟動也不會觸發讀取。

Workflow 在 GET 前驗證 active mapping、Ticket／container／item identity，以及原始成功 create attempt 的精確 snapshot proof。
此檢查不依賴後續 mapped update／close／reopen history。Archived Ticket 或 item 本身不代表 mapping termination。
GET 在 transaction 外執行；unknown、404、provider exception 或不合法 JSON／managed fields 只回傳 sanitized code/status，沒有 actor、audit、snapshot、drift 或 outbound attempt。

成功讀取後，在同一 SQLite writer transaction 內重新驗證 mapping identity、active lifecycle、termination absence 與目前 approved Ticket Revision。
若 GET 期間 mapping 被終止或 identity 改變，拋出 `CONFLICT` 並捨棄這次觀察，所有 capture writes 與 actor registration 都會回滾。
這是 stale read 不保存 snapshot 的明確例外，不會重新加入同步或復活 mapping。

比對採用 commit-time approved revision 的完整 payload，但 marker 使用原始 create intent 的 idempotency key。
每次 explicit read 都建立獨立、不可變的 External Work Item Snapshot 與 `plane_observations` provenance；相同資料的重複讀取也不去重。
有差異時建立一筆 Content Drift，diff 格式為 `{schema_version: 1, source_ticket_revision_id, changes}`，同時 pin 比對 revision；matching read 仍保存 revision provenance。
一次 `plane_mapping.observed` audit 記錄 IDs 與 changed-field count；audit、snapshot、provenance、optional drift 任一寫入失敗會整筆回滾。

Snapshot `capturedAt` 是 GET 回應收到並通過資料驗證後的時間；audit `createdAt` 是本機 commit transaction 的時間。
Concurrent GETs 可以按不同順序完成；每筆都是歷史觀察，不會依 commit 順序覆寫 item metadata、external status 或最新狀態 pointer。
外部 status 與 concurrency token 原樣保留為 string/null，不推導內部 Delivery Status。

Inbound observation 不會更新 Sync Intent／Attempt、mapping source revision、Operation Receipt 或成功 outbound snapshot proof。
因此 Content Drift 與 outbound Sync Health `current` 可以同時存在；新的 approved revision 尚未同步時出現差異，也不代表有人手動改動 Plane。
未來 outbound baseline 必須選取成功 outbound attempt 指向的精確 snapshot，不能採用任意最新 inbound snapshot。
既有 drift 不會因後續 matching observation 自動解決。此功能不提供 resolution、adoption、PATCH、status reconciliation 或 scheduler。
