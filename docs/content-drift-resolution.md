# Content Drift 處置

`reject_content_drift` 是 full profile 的明確處置指令，輸入已保存的 `content_drift_id` 與非空白 `reason`。Server 決定 Local Actor 與事件時間，原子保存 rejection Decision、audit 與 Content Drift Resolution。它不呼叫 Plane、不覆寫任何外部欄位，不更改 Ticket、Targets、mapping lifecycle、同步 intents／attempts 或驗收狀態。

## 證據與處置

回傳 `content_drift_id`、mapping／Ticket／snapshot／captured revision 的 evidence IDs，以及 `resolution.record`、`resolution.decision` 和空的 `resolution.draft`；成功 envelope 的 `audit_log_id` 指向同一次處置。Reason 經 trim，actor 與時間只保存在 Decision。處置表示使用者選擇不採用外部變動，不表示已同步外部內容或接受實作。

原始 Snapshot、diff 與 Content Drift 逐位元保留。`content_drift_resolutions` 是唯一權威關聯，raw drift 的 `resolution_decision_id` 不更新。共用處置讀取及 serializer 由有效關聯取得結果；原有 observation history 的處置整合由後續 #97 交付，目前不可用該歷史列表的 raw pointer 判斷新處置是否存在。

同一 drift 再次處置一律回 `CONFLICT`，包含既有 `resolution_id`／`decision_id`，不建立第二個 Decision。此一次性決策沒有 Operation Receipt replay 或重開語意。有效的歷史 Project、Ticket、外部 item 和已終止／替換 mapping 仍可拒絕；目前 Spec 的變動或封存不取消歷史證據。

## 驗證與保存

只驗指定 drift 所引用的 mapping 身分、snapshot、observation、歷史 approved revision、capture audit、actor 與 pinned diff。無關 observation、sync intent 或 sync attempt 損壞不會阻擋這份證據。不存在的 drift 回 `NOT_FOUND`；已存在但缺件、跨 scope、損壞 JSON、衝突 sibling 或無有效關聯的 legacy raw reference 回 `CONFLICT`。非資料驗證的 storage failures 保留原錯誤。

Migration 011 增加不可變關聯，並保護關聯及其 Decision 的 UPDATE／DELETE，以及 raw resolution pointer 的修改。寫入需要同一 transaction，先取得 writer lock，再檢查既有關聯；Decision、audit 或關聯任何寫入失敗，都連同新 actor 回滾。兩連線競爭至多形成一份處置。

共用資料契約預留 `adopt` 與唯一候選 draft 參照，並鎖定該 revision 的內容和 base／source provenance；正常 approval／lifecycle 轉移仍可更新。採用指令已由 #96 提供；獨立讀取 tool／resource 與 observation history 整合由 #97 交付。


## 選擇性採用候選規格

Full profile 的 `adopt_content_drift` 接受 `content_drift_id`、非空白 `reason`、明確的最新 `base_approved_revision_id`、`source_graph_revision_id`，以及和正常 Ticket draft 相同的完整結構化 `specification`。Ticket／Project／mapping 皆從證據推導，不可由 client 改指定。回傳共用處置 DTO，其中 `resolution.draft` 是正常 Ticket Revision，另提供 `proposed_implementation_targets`；候選尚未核准，沒有完成實作或外部同步。

Client 先評估外部變動：既有 Spec 範圍內的修訂可整理為 mapped Ticket 候選；產品目標或能力改變，須先經正常 Brief／Milestone／Spec 流程更新並重新比對來源。獨立新能力應另拆 Ticket，不能藉本指令跨 Ticket 採用，也不應將原 drift 誤標為已處置。Server 驗證結構與版本，不判斷敘述是否符合產品意圖；不解析或清洗外部 HTML 成為 specification。精確 snapshot 與 diff 保留，使用者可只採用選定文字，不能宣稱每項外部差異都已套用。

至少須有一項已保存的 name／description_html 差異。只有 identity marker 改變回 `CONFLICT`（`no_saved_specification_change`）；混合差異仍可採用文字，但不修改 mapping 或外部 markers。Captured comparison revision 可比 adoption base 舊，兩者與新 draft 都保有各自 provenance。

採用在同一 writer transaction 檢查最新 graph/base 與 Product Intent Reconciliation，再重用正常 Ticket workflow 的來源、repository、dependencies、lineage 與 target proposal 驗證。階層專案必須有完整且已重新比對的 Spec → Milestone → Brief；只有 root pointers 一致不夠。候選可繼承 base 的 source_spec_id 或明確選擇有效 Spec，也可用已重新比對的來源修復舊 Ticket 的 stale 狀態。不額外要求舊 Ticket 仍然新鮮；legacy full 專案維持原 source 規則。這個 reconciliation guard 不更改一般建立 draft 的行為。

所有處置寫入及 normal draft audit 共用一次 server 時間，任一失敗連同新 actor、draft 與關聯完全回滾。重複採用或 adopt/reject 競爭返回既有 resolution ID 的 conflict。Draft 建立不改 Ticket pointer、title、delivery、active targets、既有交付 artifacts 或 outbound intents；後續正常 approval 才重新驗證來源／base、更新 Ticket 並依既有 enrollment 建立同步義務。中間另有 approval 會使候選 stale，不能自動 rebase，原 Decision 仍保留。後續 handoff、Result 與 Acceptance 仍遵守既有來源及 concurrency 檢查。
