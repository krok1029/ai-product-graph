# ADR 0040：階層規劃與自動圖譜同步

2026-09-28，使用者指出直接從 Product Brief 拆 Tickets 過粗，要求先確認主要 Milestones，再拆 Specs，最後參考 `to-spec`／`to-tickets` 產生垂直切片 Tickets；各規劃節點變動必須同步圖譜，無需另一次圖譜核准。

決定將 `product_brief`、`milestone`、`spec` 作為正式 GraphNode types。Milestone／Spec 內容與父來源 revision 放在 metadata，child → parent 使用 `belongs_to`。沿用 Graph Draft Batch 的 immutable changes 與 Graph Revision 記錄，不新增平行的規劃儲存模型。`save_planning_node` 同一 transaction 驗證並套用內容與關係；記錄 automation actor 與 applied audit，內部 batch 的 approved 狀態只表示已套用。

此決定取代 ADR0014 對新規劃圖譜必須人工核准的要求，調整 ADR0015 的 Product Brief ownership 類型及 ADR0039 的 core 介面。ADR0026 的 optimistic concurrency、identity 保護、atomic rollback 仍保留。舊 full graph tools 限於原有產品意圖，不允許繞過新階層驗證。

新流程的 Ticket 必須明確來自 Spec，保存完整 Spec → Milestone → Brief ancestry。父節點變動時不自動重寫下游規格；先回報 stale descendants，再由 agent 依現有狀況重新比對。Ticket 既有 freshness 檢查透過來源 Graph Revision 阻擋過期實作與接受。Product Brief approval 會在 core 自動投影根節點；已採用階層的 project 即使使用舊 facade 也維持同步。尚未採用階層的 full 舊專案保持原規則。

不將所有規劃放在 skill 文字或 Markdown，因為來源完整性與交易保證須由程式維持。也不依節點種類各加一組 create／update／approve tools：以一個深的 planning 寫入入口替換 core 的兩個 graph batch tools，core 從 24 降至 23。Milestone、Spec 的內容生成、階段判斷及垂直切片品質屬於 skill；server 只保證結構與版本，不聲稱機器驗證可取代產品判斷。

保留 Product Brief、Ticket 與交付的對話決策，不將圖譜套用等同於 Result Acceptance。封存 Milestone 連帶封存 Specs 與 active edges，保留 Ticket 與其歷史，不自行撤銷既有驗收。不遷移或猜測舊使用者資料的階層，不恢復已暫停的外部整合 roadmap。
