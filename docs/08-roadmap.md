# Roadmap

2026-09-28（Asia/Taipei）核對：依 GitHub 已合併 PR、未結 Issues 與即時 MCP 資料更新。後續順序仍為「統一版本基線 → 驗證持續開發與接手 → 改善進度與變更說明 → 按需求恢復外部整合」。本次只更新文件，沒有重跑程式測試或接受產品結果。來源、版本差異與剩餘工作見 [進度核對紀錄](validation/2026-09-28-project-status.md)。

GitHub Issues 是 Specs 與 Tickets 的正式追蹤來源；本文件定義階段成果、範圍、順序與退出條件。SQLite 中的使用者 Project 不等同於本 repository 的 roadmap。

2026-09-28 範圍決策：依使用者指示，移除雲端與多人版本，不列入本專案目前的待辦或完成條件。產品維持本機、單人使用；Hosted MCP、多人帳號／權限／協作及為此安排的 Postgres 遷移均退出目前範圍。Plane 外部連接及本機 Web 介面仍可獨立評估。

同日後續決策：GitHub 專用 adapter 移出必做清單與完成條件。Agent 使用 `gh` 操作 Issue／PR，再以既有 evidence／Result 流程保存可追溯資料；不另建 GitHub API 包裝或背景同步。只有實際使用出現可重現的漏記、重複操作或同步需求時，才定義最小補強。

## 目前能力與原階段對照

| 原規劃 | 目前狀態 | 後續處理 |
| --- | --- | --- |
| Phase 0 規劃 | 初始基線已有 ADR0039–0041 的後續調整 | 以新版需求、工作流及本 roadmap 為入口 |
| Phase 1 本機 MCP | 已有規劃、實作、驗收主流程與 core/full profiles | 整理版本基線並驗證實際使用成本 |
| Phase 2 真實儲存 | SQLite、repositories、版本與 audit 已落地 | 本機 SQLite 為目前儲存方案；不排入 Postgres 遷移 |
| Phase 3 Plane | 部分完成，見下方能力邊界 | 保留既有成果，後續開發暫緩 |
| Phase 4 GitHub | 專用 adapter 已移出必做範圍 | 使用 `gh` 與既有證據流程；按真實缺口評估最小補強 |
| Phase 5 AI 實作 | 本機 handoff、evidence、Acceptance／Revocation 已落地 | 跨對話實作不依賴先做 GitHub adapter；PR 自動化另評估 |
| Phase 6 UI | 未開始 | 現有查詢不足以支援實際操作時才另立規格 |

## Milestone 1：統一目前版本基線

**成果**：規劃文件、skills、工具行為與交付狀態對得起來，後續 agent 不會沿用已被取代的工作流。

**狀態**：核心基線已經由 [PR #99](https://github.com/krok1029/ai-product-graph/pull/99) 合併，[#100](https://github.com/krok1029/ai-product-graph/issues/100) 已關閉。該 PR 的固定提交通過 836 項測試、雙型別檢查、建置、smoke 及介面探查。早先的 [工作目錄基線紀錄](validation/2026-09-28-workflow-baseline.md) 保留當時未提交的事實，不能當作目前尚未交付的證據。本機原工作目錄仍停在舊 HEAD 並保留未提交內容，亦不代表已自動更新到遠端主分支；連線中 MCP process 的實際載入版本仍未核實。

範圍：

- 統一 Product Brief → Milestone → Spec → Ticket → 實作 → 驗收。
- 說清 core 23 tools／三個 skills、full 六個舊 prompts 的用途；原基線 full 43 tools，後續差異處置交付後的主分支為 46 tools。
- 對齊圖譜自動保存、同範圍實作授權、獨立 Result Acceptance 及規劃內容版本。
- 將舊 Phase 1／1A 文件標成歷史基線，保留有效 storage／transaction 約束。
- 整理目前程式碼與驗證紀錄，區分已交付、尚未提交及未完成的能力。

退出條件：

- 使用者文件不再把 graph approval、中間 Markdown 文件或 PR 當作預設必經步驟。
- 後續 Issues 引用新版階層與相容邊界，沒有未經重審便可啟動的舊 ready-for-agent 工作。
- 記錄驗證對應的 commit／dirty baseline、core/full 介面及適用檢查結果；文件修訂本身只做文件檢查，不能冒稱重跑或通過程式測試。

不包含：新功能、資料遷移、同步 processor、公開部署。

## Milestone 2：驗證持續開發與跨對話接手

**成果**：證明來源追溯和驗收紀錄可以減少重做，並建立實際管理成本的基準。

**狀態**：工程收尾中。#101 已固定起點；#102 完成情境 A 的新增篩選、驗收及原交付沿用；#103／#111 完成來源影響與排序接手檢查點；[#104／PR #115](https://github.com/krok1029/ai-product-graph/pull/115) 已完成真實新任務的唯讀接手。#105 已保存來源往返、過期 handoff／pending Acceptance 的拒絕證據，清單 r3 待接受、篩選 r2 來源有效但依賴清單。使用者現授權自主推進到本機流程工程收尾，再一次審查；#121 先完成隔離驗證，正式 Acceptance 不由工程 review 代替。#106 彙整成果與成本限制，#98 原始完整驗收要求仍留待最終核對。

依賴：先固定可重現的 Milestone 1 版本基線。使用同一個有持續變更需求的獨立測試 Project；不得假設先前已刪除的試用資料仍存在，也不自動還原它們。

範圍與退出條件：

1. **新增能力**：從已接受功能擴充需求，重新比對上游；原 Spec 內容未變且其他來源有效時，原 Ticket Revision、Brief、Result 與 Acceptance IDs 保持不變，只交付新增工作。
2. **修改既有能力**：真正修改 Spec 後，過期 handoff／新 Acceptance 被阻擋；影響清單含正確的引用與依賴，無關工作保持可用。修訂受影響工作後恢復交付，歷史 Acceptance 保留。
3. **換對話接手**：以持久資料辨識 done、stale、blocked 與 pending Result；不重建已有計畫／結果、不要求使用者重述可查得的規格。再次實作仍驗證真實 Repository baseline。
4. 每個情境記錄耗時、有效工作時間與等待時間、必要決策、重複確認、人工修正及重複 artifacts；功能正確性與操作成本分開判定。
5. 缺陷或額外負擔記成具體 follow-up；先建立基準，再以同類情境回放比較，不用工具數或測試數推算省時比例。沒有比較資料時只報基準，不宣稱已有改善幅度。

不包含：為取得數據先開發遙測平台、dashboard、背景自動化或外部同步。

## Milestone 3：改善進度與變更說明

**成果**：對話能準確回答「階段做到哪裡、為何卡住、改動影響什麼、下一步是什麼」。

**狀態**：使用者已授權進入本機收尾改善。依已觀察到的 runtime 來源與階段分組缺口，新增 Spec #116／#117 與 Tickets #119／#120 並行；先測試、獨立 review、合併，再以新基線驗證。Spec #118 統籌工程證據與最後審查材料，不自動完成使用者產品驗收。

依賴：Milestone 2 的實際問題。先以既有 graph、planning、delivery 與 work context 整理階段摘要；只有資料缺口可重現時才新增 API／projection。

退出條件：

- 按 Milestone／Spec 組織 Ticket 進度，顯示依賴、來源問題、待接受結果及證據缺口。
- 區分歷史完成與目前來源有效性，不能把 done＋stale 當成未曾完成，也不能把它當成新需求已完成。
- 摘要可追溯至正式版本、Result 與 Acceptance；所有 Tickets done 不自動滿足 Milestone 的退出條件。
- 對量測中確認的問題回放同類情境，說明實際減少的重複步驟及仍需人工判斷的部分。

不包含：自動核准、Milestone 自動完成、完整 UI 或新增一套手動維護的進度狀態。

## Milestone 4：按實際需求恢復外部整合

**狀態**：已有部分後續成果合併，不能再將 #95–#97 列為未開工。其餘 Plane 整合擴充仍待選定具體交付範圍；GitHub 改由 `gh` 操作，不安排專用 adapter 階段。

保留能力邊界：

- Plane 已有 container、明確首次 export request、durable create／reconciliation 核心及單次 HTTP CLI。
- 已有 active mapping 的後續 content/status outbox、ordered sync plan、supersession、health、mapping termination 及歷史查詢。
- 已有明確單次 observation CLI、不可變 snapshot 與 Content Drift 歷史。
- Content Drift 的拒絕、採用為候選 Ticket Revision Draft、處置及歷史查詢已合併到主分支，僅屬 full profile。處置不等於候選核准、產品接受或外部同步。
- Plane 後續 update/status execution 與完整雙向狀態衝突處理尚未完成。Outbox 保存不等於外部已同步。

[Spec #94](https://github.com/krok1029/ai-product-graph/issues/94) 仍開啟，但子票 #95／#96／#97 分別由 [PR #107](https://github.com/krok1029/ai-product-graph/pull/107)、[PR #110](https://github.com/krok1029/ai-product-graph/pull/110)、[PR #109](https://github.com/krok1029/ai-product-graph/pull/109) 合併並關閉。父 Spec 的暫緩文字及未勾選清單已落後，仍需核對父層驗收後收尾；不能算成三張尚未實作的功能票。這組工作不包含 outbound processor。

恢復時每份 Spec 交付一條完整可驗證的使用情境，保持以下約束：

- 外部 mutation／resolution tools 由 full 提供，core 不增加整合義務；啟動不自動發送請求。
- 首次匯出須使用者明確選擇；active mapping 的 durable enrollment 不因暫緩 roadmap 或切換 profile 被關閉。
- 外部內容先保存證據；涉及新需求時先更新上游規劃，再建立有效來源的候選 Ticket Revision。server 驗證結構與版本，不判定自然語言規格是否語意一致。
- 內容差異已處理、草稿已核准、實作已接受、外部同步成功是不同狀態。
- 保留並發保護、欄位 ownership、immutable history、逐 mapping 序列與失敗恢復；外部 done 不取代 Result Acceptance。

## 尚未排入交付

本機 Web UI、embeddings 及其他 provider adapters。只有前述情境顯示現有方案不足時，再建立具體 Spec 與退出條件。雲端與多人版本已移出目前範圍，不是等待排期的必要階段。

## 距離完成還有多少工作

原本本機 MCP MVP 的核心能力已交付，#104 已完成。原 #105／#106 繼續保留完整驗收及報告追蹤；使用者改為最後集中審查，因此不把 live pending Result 或被它阻擋的篩選偽稱已接受。

本輪分為三份 Spec：[#116 執行基線](https://github.com/krok1029/ai-product-graph/issues/116)、[#117 階段進度](https://github.com/krok1029/ai-product-graph/issues/117)、[#118 工程收尾](https://github.com/krok1029/ai-product-graph/issues/118)。#119 runtime、#120 進度投影、#121 隔離工程驗證、#122 範圍與決策文件可並行；最後 [#123 審查包](https://github.com/krok1029/ai-product-graph/issues/123) 依賴這些成果。每票各有 PR 與獨立 Spec／Standards review，無未解決問題才合併。暫定決策與調整方法見 [決策紀錄](validation/2026-09-28-closeout-decisions.md)。

這輪停止點為「本機工程成果、必要驗證、PR 與審查材料齊備」。使用者最終 Result Acceptance、父 Spec／Milestone 判定另列待審，不自動代簽。Plane 完整同步與本機 Web UI 均不在本輪實作範圍；雲端多人與 GitHub adapter 不再是必做階段。
