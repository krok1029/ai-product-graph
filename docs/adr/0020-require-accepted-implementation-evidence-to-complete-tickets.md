# ADR 0020：Ticket 完成必須具有已接受的實作證據

## Status

Accepted

## Context

Coding agent 可以回報已完成實作，但這項回報本身不能證明 agent 使用了哪一版 Implementation Brief、產生了哪些程式碼變更、執行了哪些測試，或仍有哪些未完成事項。

如果 agent 回報完成就自動把 Ticket 標為 `done`，graph 可能出現無法追溯或實際未完成的交付狀態。如果使用者可以在沒有證據的情況下直接切換到 `done`，則 ADR 0016 所分離的 Delivery Status 仍缺少可信的完成語意。

## Options Considered

### A：Agent 回報完成後自動標記 Done

優點：

- Automation 程度最高。
- Coding workflow 步驟最少。

缺點：

- Agent 的自我宣告可能不正確或不完整。
- 無法保證 Ticket、brief、commits、PR 與 tests 之間的追溯。
- 使用者沒有最終驗收關卡。

### B：使用者可直接把 Ticket 標記為 Done

優點：

- 最終決定仍由使用者掌握。
- 不需要新增結果 artifact。

缺點：

- `done` 可能沒有結構化實作證據。
- 後續無法可靠回答完成依據與實際產出。

### C：提交 Implementation Result，經使用者接受後標記 Done

優點：

- 實作結果能追溯到精確 handoff 與程式碼產物。
- Agent completion claim 與使用者 acceptance 明確分離。
- Graph 可以保存 tickets、commits、PRs 與 tests 的可靠關係。

缺點：

- Completion workflow 多一個提交與接受步驟。
- Client 必須收集及提交結構化 evidence。

## Decision

採用選項 C：Coding client 必須先提交 Implementation Result，使用者明確接受後，Ticket 才能把 Delivery Status 更新為 `done`。

Implementation Result 必須綁定實際使用的 Implementation Brief 版本，並記錄 resulting commits 或 pull request、測試結果及未完成事項。提交結果只代表一次候選實作結果，不構成 completion。

Implementation Result 與 Result Acceptance 只適用於該 brief 所綁定的精確 Ticket Revision 與 Implementation Target。Ticket Revision 更新後，舊 acceptance 不得自動沿用。既有 commits、PRs 與 test evidence 可以被新的 Result 引用，但 criterion verdict 與使用者 acceptance 必須重新建立。

Replacement Ticket Revision 核准時，Ticket Delivery Status 必須重設為 `planned`，即使舊 revision 已是 `done`、`in_progress` 或 `blocked`。舊 Results 與 Acceptances 保留歷史，但不再支撐目前 revision 的 completion。

同一 transaction 必須以 `source_revision_superseded` archive 舊 revision 的 active draft 與 approved Implementation Results。Result Review Status、Result Acceptances 與 Observed Evidence 保留不變；archive 只讓 artifacts 退出目前有效範圍。

Late Result submission 的 valid Observed Evidence 必須保存，但若綁定來源已 stale，Result 只能建立為 `stale_at_submission` archived draft。它不得 acceptance、supersede active approved Result 或更新 Delivery Status；evidence 可供 current revision 的新 Result 引用。

Product Intent Reconciliation 為 `pending` 時也適用相同規則：Result submission 保存 valid evidence，但建立帶有 `product_intent_unreconciled` reason 的 archived draft Result；Result Acceptance 必須阻擋。Reconciliation 完成後，未受實際 graph changes 影響的既有 Results 仍可依原規則接受。

Server 必須先驗證 Result 與 Implementation Brief、Ticket revision 及 repository evidence 的來源關係。驗證成功後，使用者才能執行 Result Acceptance；該動作會保存接受紀錄，並把對應 Ticket 更新為 `done`。

Implementation Result 是不可變且具有 Review Status 的 artifact。Client 提交時為 `draft`；Result Acceptance 是將其核准為 `approved` 的明確 Approval event，其 `actor_id` 與 `accepted_at` 是接受操作者與時間的唯一權威來源。Server 必須從目前 Local Actor 產生 actor，並在 transaction 開始時只擷取一次 event time，將它同時寫入 Acceptance `accepted_at`、所有 criterion outcomes `created_at` 與本次 Waiver Decisions `created_at`；client 不得提供或覆寫這些值。Implementation Result 不重複保存 approval actor 或 time，也不另建立 `pending | accepted` 的重複狀態軸。

`accept_implementation_result` 與 `revoke_result_acceptance` 都必須要求 client-provided idempotency key，且 input 不直接接受 `project_id`。Server 必須先分別由 `implementation_result_id` 或 `result_acceptance_id` 做 identity-only resolution，只確認 target identity 存在並取得 Project scope，不驗證 lifecycle、current state 或其他 business validity；找不到 target 時立即回傳 `NOT_FOUND`，不得查找或建立 Operation Receipt。解析成功後才做 Operation Receipt lookup，只有 receipt miss 才做完整 target state validation。同一 Project、Local Actor、operation、key 與相同 normalized command hash 命中 receipt 時必須 replay，即使目標已因原成功 transaction 而不再可執行。Server 必須在成功 domain transaction 內保存 Operation Receipt，將 Project、server-derived Local Actor、operation name、idempotency key、normalized command fingerprint、原始成功 response data 與恰好一個 domain event 綁定；Phase 1A receipt 只能綁定 Result Acceptance 或 Result Revocation 其中一個，且 operation name 必須與該 event 類型一致；每個 Result Acceptance 或 Result Revocation 最多只能被一筆 receipt 引用。Operation Receipt 與其 replay 路徑上的 Implementation Result、Result Acceptance、Result Revocation 都不得 hard delete；Result 只能透過 Lifecycle Status archive，Receipt、Acceptance 與 Revocation 沒有 lifecycle 軸且永久保留。Normalized command fingerprint 必須使用 RFC 8785 canonical JSON bytes + SHA-256，與 Observed Evidence payload hash 採相同 canonicalization 規則。Receipt 的 `response_json` 只保存 successful `ToolResult.data` 的 RFC 8785 canonical JSON UTF-8 text，不保存完整 envelope；replay 時 server 重新包成目前標準的 `{ ok: true, data, audit_log_id? }`，其中 top-level `audit_log_id` 必須是原始成功 domain transaction 的 audit log ID，不得被 replay observability log ID 取代。相同 Project、Local Actor、key 與 command 的重試必須回放原始 response data，且不得在 `data` 中新增 `replayed`、`receipt_id` 或其他 replay marker；replay observability 只能透過 audit log、server log 或非 domain envelope metadata 表示。同 key 但 command 不同必須回傳 `CONFLICT`。不同 key 即使 command 相同也代表新的 logical command；若目標已因先前成功操作而不再可執行，必須回傳一般 `CONFLICT`，不得反查既有 acceptance／revocation 當作 replay。失敗 response 不保存也不 replay，避免暫時性 validation、stale 或 conflict 狀態在修正後仍卡住同一 logical retry。

同一 Implementation Target 最多只能有一份 active approved Result。更正已接受結果時，新 Result 必須使用 `supersedes_implementation_result_id` 指向舊 Result；acceptance 必須原子 archive 舊 Result 與其他 draft attempts，並保留完整歷史。

每個 Implementation Result 透過 Implementation Brief 對應單一 Implementation Target。Ticket 只有在目前 approved Ticket Revision 的所有 required Implementation Targets 都具有 accepted Implementation Result 時，才能更新為 `done`。

缺少可驗證 Implementation Result 或 Result Acceptance 時，Ticket 不得標為 `done`，只能維持 `in_progress` 或 `blocked`。

Plane、GitHub 或其他 External Work Item 的 closed／done 狀態不構成 Result Acceptance。它可以作為 external status 保存及觸發使用者注意，但不得直接完成內部 Ticket。只有內部 completion 成立後，adapter 才可向外同步關閉 work item。

若使用者事後確認某項 Result Acceptance 在作成當時即無效，無論 Ticket 是否已完成，都必須能執行明確的 Result Revocation：建立保存 actor、時間與理由的 Decision node，Revocation 只引用該 Decision，並 archive 對應的 active approved Result。Ticket 若已是 `done`，必須退回 `in_progress` 或 `blocked`；尚未完成則保留原 Delivery Status。原 Result、Acceptance 與 evidence 仍保留為不可變歷史。

新需求、後續 regression 或原 acceptance criteria 未涵蓋的問題不表示原 acceptance 無效。這類工作必須建立以 `traces_to` 關係連回原 Ticket 的 Follow-up Ticket，原 Ticket 維持 `done`。

## Rationale

- `done` 應代表一個可證明且被使用者接受的交付結果。
- 結構化 result artifact 能封閉 Product Brief、Ticket、handoff、code change 與 test evidence 的追溯鏈。
- 人類 acceptance 可避免 coding agent 對自身產出的錯誤判斷直接成為 canonical delivery state。

## Trade-offs

- 接受每次完成 Ticket 都需要額外的人類 acceptance。
- 接受 client integration 必須收集 commits、PRs 與 test results。
- 接受無法提供證據時，即使程式碼看似完成也不能標記 `done`。

## Consequences

- Domain model 必須包含 Implementation Result 與 Result Acceptance。
- Implementation Result 必須具有 draft／approved Review Status 與 active／archived Lifecycle Status。
- Result Acceptance 必須是接受操作者與時間的唯一權威來源；Implementation Result 不得重複保存 approval actor 或 time。
- Result Acceptance 的 actor 與時間必須由 server 產生；command 不得接受 client-provided acceptance actor 或 time。
- Acceptance、所有 criterion outcomes 與本次 Waiver Decisions 必須共用 transaction 開始時擷取的單一 event time。
- Acceptance command 必須具有 Project + Local Actor scoped idempotency key，並以 Operation Receipt 支援原始成功 response data replay。
- Revocation command 必須具有 Project + Local Actor scoped idempotency key，並以 Operation Receipt 支援原始成功 response data replay。
- Receipt replay 鏈上的 Implementation Result、Result Acceptance、Result Revocation 與 Operation Receipt 都不得 hard delete。
- SQLite schema 必須以 delete-guard triggers 無條件保護 Operation Receipt、Result Acceptance 與 Result Revocation，並在 Implementation Result 已進入 receipt replay 鏈時保護該 Result。
- Acceptance command 必須回傳 criterion outcomes 的完整 canonical rows，包含 stable identity、所屬 Acceptance 與 event time。
- Acceptance response 的 criterion outcomes 必須使用 approved Ticket Revision 的 criterion 規格順序；Waiver Decisions 必須跟隨對應 Outcome 的順序。
- Result Acceptance 必須強制每個 Implementation Target 的 active approved Result 唯一性。
- Result submission tool 必須要求 Implementation Brief version 與結構化 evidence。
- Ticket completion operation 必須驗證已接受的 Implementation Result。
- Ticket completion operation 必須驗證所有 required Implementation Targets 都具有 accepted result。
- External Work Item 的 closed／done 狀態不得作為 Ticket completion evidence 或繞過 Result Acceptance。
- Result Acceptance 不得跨 Ticket Revisions 或 Implementation Targets 重用。
- Replacement Ticket Revision approval 必須把 Delivery Status 重設為 `planned`；舊 acceptance 不得維持目前 `done`。
- Replacement revision 必須 archive 舊 revision 的 active Results，保留 Review Status、Acceptances 與 evidence。
- Stale-at-submission Result 必須 archived 且不可接受，但 valid Observed Evidence 應保留供新 Result 重用。
- Product Intent Reconciliation pending 時不得接受 Result，也不得讓既有 acceptance 推進新的 completion decision。
- Result Revocation 必須保留原 Result、Acceptance 與 evidence，並原子 archive Result、建立撤銷紀錄，以及在 Ticket 原為 `done` 時更新 Delivery Status。
- 驗收範圍外的新工作必須建立 Follow-up Ticket，不得以 revocation reopen 原 Ticket。
- Graph 應建立 Ticket、Implementation Brief、commit／pull request 與 test evidence 之間的 traceability edges。
- Audit log 必須記錄 result submission、validation、acceptance、revocation 與 Delivery Status change。
