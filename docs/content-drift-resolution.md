# Content Drift 處置

`reject_content_drift` 是 full profile 的明確處置指令，輸入已保存的 `content_drift_id` 與非空白 `reason`。Server 決定 Local Actor 與事件時間，原子保存 rejection Decision、audit 與 Content Drift Resolution。它不呼叫 Plane、不覆寫任何外部欄位，不更改 Ticket、Targets、mapping lifecycle、同步 intents／attempts 或驗收狀態。

## 證據與處置

回傳 `content_drift_id`、mapping／Ticket／snapshot／captured revision 的 evidence IDs，以及 `resolution.record`、`resolution.decision` 和空的 `resolution.draft`；成功 envelope 的 `audit_log_id` 指向同一次處置。Reason 經 trim，actor 與時間只保存在 Decision。處置表示使用者選擇不採用外部變動，不表示已同步外部內容或接受實作。

原始 Snapshot、diff 與 Content Drift 逐位元保留。`content_drift_resolutions` 是唯一權威關聯，raw drift 的 `resolution_decision_id` 不更新。單筆處置讀取與 observation history 共用驗證及 serializer，由有效關聯取得處置及公開 pointer。未處置為 null；無有效關聯的 raw pointer 回 conflict。讀取契約詳見 [MCP tool 規格](12-mcp-tool-spec.md#get_content_drift_resolutionfull)。

同一 drift 再次處置一律回 `CONFLICT`，包含既有 `resolution_id`／`decision_id`，不建立第二個 Decision。此一次性決策沒有 Operation Receipt replay 或重開語意。有效的歷史 Project、Ticket、外部 item 和已終止／替換 mapping 仍可拒絕；目前 Spec 的變動或封存不取消歷史證據。

## 驗證與保存

只驗指定 drift 所引用的 mapping 身分、snapshot、observation、歷史 approved revision、capture audit、actor 與 pinned diff。無關 observation、sync intent 或 sync attempt 損壞不會阻擋這份證據。不存在的 drift 回 `NOT_FOUND`；已存在但缺件、跨 scope、損壞 JSON、衝突 sibling 或無有效關聯的 legacy raw reference 回 `CONFLICT`。非資料驗證的 storage failures 保留原錯誤。

Migration 011 增加不可變關聯，並保護關聯及其 Decision 的 UPDATE／DELETE，以及 raw resolution pointer 的修改。寫入需要同一 transaction，先取得 writer lock，再檢查既有關聯；Decision、audit 或關聯任何寫入失敗，都連同新 actor 回滾。兩連線競爭至多形成一份處置。

共用資料契約預留 `adopt` 與唯一候選 draft 參照，並鎖定該 revision 的內容和 base／source provenance；正常 approval／lifecycle 轉移仍可更新。採用指令本身由 #96 交付；full profile 已提供 `get_content_drift_resolution` 與 `product-graph://content-drifts/{driftId}/resolution`，可讀取候選 draft 的目前 review／lifecycle，不把狀態變動誤當成重新處置。
