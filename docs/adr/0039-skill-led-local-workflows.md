# ADR 0039：Skills 主導本機流程，MCP 保留資料與驗證

> 後續調整：新階層規劃與自動圖譜同步依 [ADR0040](0040-planning-hierarchy-and-automatic-graph.md)，此處保留原決策歷史。

2026-09-27，使用者完成 MVP 試用後要求精簡介面。預設改為 core profile，提供 24 個本機 tools，由規劃、實作、驗收三個 skills 編排；full profile 保留原本 39 個 tools、6 個 prompts，並包含三個新入口。此決定調整 ADR0003／0005 的預設工作流入口，不改 SQLite 作為正式資料來源或 client 執行 generation 的責任。

保留版本、Approval、Implementation Brief、Evidence 與 Result 的持久化及驗證；移除使用者必須額外製作中間 Markdown／JSON 文件的流程要求。`start_implementation` 將已展示 draft 的對話核准與 handoff 檢查合併，`submit_work_result` 在一個 transaction 保存 evidence 與候選 Result。這些是較深的 module interface，不新增 lifecycle，也不將技能文字當成 transaction 保證。

不採用直接以 skill 修改 SQLite，因為跨版本、跨 repository 的正確性仍需由程式保證；也不以單一任意 action/SQL tool 隱藏全部操作。代價是 core/full 兩種介面需同時驗證，skills 的自然語言表現仍需真實使用評估。外部整合為選配，既有 mapping 的 durable enrollment 規則不變；core profile 不提供外部 processor，也不恢復已暫停的後續 roadmap。

ADR0017/0019 的 Brief 與 freshness 保證保留：只在使用者對既存精確 draft 的對話同意後開始交付；失敗時 rollback 新 approval／前版 archival，另保存 blocked handoff audit。已核准 brief 再次 start 僅驗證，不重複核准。Result Acceptance 仍是獨立的使用者決策，不能因工具呼叫變少而自行完成 Ticket。
