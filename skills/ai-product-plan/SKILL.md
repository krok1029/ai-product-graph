---
name: ai-product-plan
description: 使用 AI Product Graph 依 Product Brief、Milestone、Spec、Ticket 階層規劃產品，並隨內容變更同步圖譜。適用於此 MCP 的產品規劃、階段拆解、規格與 tickets，不用於一般程式修改。
---

# 產品規劃

以使用者要解決的問題為起點，產出足以實作的小範圍規劃。使用已連線的 AI Product Graph MCP tools；先取得實際 tool schema，不猜 ID。若找不到此 MCP，說明缺少連線，保留討論內容，不宣稱資料已保存。

- 先沿用既有 Project；需要時透過 `list_projects`、`get_project`、Project resources 與 `get_graph_context` 找到目前內容。Repository 是程式碼儲存庫，與 Project 不同。
- 用 `add_idea` 保存原始想法。只釐清會影響範圍的問題；把假設與使用者確認的事實分開。
- 用 `create_product_brief_draft` 保存完整 structured brief，展示重點與精確版本。使用者對已展示版本說「可以」「就這版」即授權呼叫 `approve_product_brief_version`，不再要求正式確認。
- 先將 Brief 拆成少數主要 **Milestones**，每個階段說清楚成果、範圍、完成條件、順序與不做的事。先在對話展示階段邊界，再展開下一層；已授權自主規劃時直接依現有狀況判斷，不增加核准關卡。尊重「完成 MVP 就停止」等截止範圍。
- 用 `save_planning_node` 保存 Milestone，再逐階段整理多份 **Specs**。一份 Spec 聚焦一個可說明的能力，不用數量湊規格。沿用 `to-spec` 的 Problem Statement、Solution、User Stories、Implementation Decisions、Testing Decisions、Out of Scope、Further Notes；從對話與程式碼綜合，不重複訪談。測試以最高且最少的既有行為邊界為主，不把易過時的檔案路徑與程式碼當成規格。
- 同一工具保存 Spec，`parent_node_id` 必須是 Milestone。保存後內容、`belongs_to` 關係、版本與 audit 一起更新，**不需展示另一份圖譜草稿或等待圖譜核准**。欄位與範例見 [planning-contract.md](references/planning-contract.md)。
- **只能從 Spec 拆 Ticket**。參考 `to-tickets` 的 tracer-bullet：每張跨越必要層次、能獨立展示或驗證、能放進一次全新實作上下文；避免資料庫／API／UI 各一張的水平拆法。列出實際 blockers、驗收條件與 non-goals。大範圍機械重構可用 expand → migrate → contract，維持每一批可驗證。
- 以 `create_ticket_draft_batch` 或 `create_ticket_revision_draft` 保存，明確填 `source_spec_id`；server 補上 Spec → Milestone → Brief 來源。`dependencies` 用已存在 Ticket IDs，依順序先保存 blockers，再保存 dependents；不要猜同批尚未建立的 IDs。每張指定 Repository targets。展示「交付什麼／驗收條件／被誰阻擋」，在使用者對精確草稿的對話同意範圍內逐一 `approve_ticket_revision`。開工時只選 blockers 已完成的工作。

修改既有規劃時先讀 `get_graph_context` 的最新 `graph_revision_id` 與 `planning.stale_node_ids`／`affected_ticket_ids`。使用 `node_id` 更新原 identity，不能以重建節點代替修訂。從上游重新比對受影響內容：仍適用時保存相同內容以確認新來源，再查影響清單；內容版本未變的 Ticket、Brief 與 Result 可沿用，不必逐層重存或重新驗收。只有實際內容、父歸屬或其他引用來源改變，使 Ticket 仍 stale 時，才建立 replacement Ticket Revision。不要憑「只是新增功能」略過來源比對，也不要為了消除 stale 任意改寫文字。每次成功保存會推進 base，下一次呼叫使用新回傳值；遇到 conflict 先重讀，不盲目重試。封存 Milestone 會同時封存其 Specs，Tickets 與歷史仍保留供追溯。

使用者已授權的規劃範圍內，持續完成必要拆解並用進度更新呈現，不在每層以「是否繼續」中斷。同一決策可合併展示數份具體 Ticket drafts，使用者一次同意後依序保存各份核准。Product Brief／Ticket 的新內容仍須取得對應同意；保存圖譜、來源確認與一般技術安排不另加確認回合。

使用者要求看圖譜或進度時，搭配 `delivery.summary` 與 `delivery.tickets` 回答：哪些工作受影響、被哪些依賴阻擋、哪些 target 缺少 criterion 證據、哪些 Result 等待接受及下一步。`delivery.scope` 是全專案 active Tickets，可能大於 graph nodes 的查詢範圍；不要將已核准或圖譜有連線誤認為完成。

不要為了填滿流程額外產生 Markdown 文件；對話摘要與正式資料就足夠，只有使用者需要文件時才匯出。品質檢查在撰寫時完成，不額外要求一輪「核准審查」。核准不延伸到尚未展示的新內容；來源衝突時重新讀取，不把舊同意套用到新版。

完成時交付 Milestone → Spec → Ticket 對應、已核准範圍、blockers 與未決事項。借用 `to-spec`／`to-tickets` 的整理方法不代表要自動發布 GitHub Issues；外部匯出仍是使用者另行要求的選配操作。不要自行推進未授權的 roadmap。
