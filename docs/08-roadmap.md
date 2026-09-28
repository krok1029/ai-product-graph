# Roadmap

2026-09-28 修訂：依 ADR0039–0041 與本機試用結果，後續順序改為「統一版本基線 → 驗證持續開發與接手 → 改善進度與變更說明 → 按需求恢復外部整合」。本次更新規劃，不代表已執行新驗證、完成所有未提交程式碼的交付，或恢復外部整合開發。

GitHub Issues 是 Specs 與 Tickets 的正式追蹤來源；本文件定義階段成果、範圍、順序與退出條件。SQLite 中的使用者 Project 不等同於本 repository 的 roadmap。

## 目前能力與原階段對照

| 原規劃 | 目前狀態 | 後續處理 |
| --- | --- | --- |
| Phase 0 規劃 | 初始基線已有 ADR0039–0041 的後續調整 | 以新版需求、工作流及本 roadmap 為入口 |
| Phase 1 本機 MCP | 已有規劃、實作、驗收主流程與 core/full profiles | 整理版本基線並驗證實際使用成本 |
| Phase 2 真實儲存 | SQLite、repositories、版本與 audit 已落地 | 不再列為待開發階段；Postgres 仍延後 |
| Phase 3 Plane | 部分完成，見下方能力邊界 | 保留既有成果，後續開發暫緩 |
| Phase 4 GitHub | 專用 adapter 未交付 | 依實際需求選擇，無須等 Plane 全部完成 |
| Phase 5 AI 實作 | 本機 handoff、evidence、Acceptance／Revocation 已落地 | 跨對話實作不依賴先做 GitHub adapter；PR 自動化另評估 |
| Phase 6 UI | 未開始 | 現有查詢不足以支援實際操作時才另立規格 |

## Milestone 1：統一目前版本基線

**成果**：規劃文件、skills、工具行為與交付狀態對得起來，後續 agent 不會沿用已被取代的工作流。

**狀態**：文件與 Issues 已對齊；2026-09-28 的工作目錄快照已通過 836 項測試、雙型別檢查、建置、smoke 及 core/full 介面探查，見 [基線紀錄](validation/2026-09-28-workflow-baseline.md)。包含未提交變更，尚未建立正式提交／PR，不能等同已發布。

範圍：

- 統一 Product Brief → Milestone → Spec → Ticket → 實作 → 驗收。
- 說清 core 23 tools／三個 skills、full 43 tools／六個舊 prompts 的用途。
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

**狀態**：已開始準備；基線檢查通過，測試產品 Brief v1 與兩張 Tickets 已核准，初版清單及獨立說明已實作並通過 11 項規則測試與桌面驗證。兩份 Result 已保存，等待使用者接受；A／B／C 實際情境尚未執行。正式規格由 [Spec #98](https://github.com/krok1029/ai-product-graph/issues/98) 追蹤；起點與結果 IDs 見 [基線紀錄](validation/2026-09-28-workflow-baseline.md)。

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

依賴：Milestone 2 的實際問題。先以既有 graph、planning、delivery 與 work context 整理階段摘要；只有資料缺口可重現時才新增 API／projection。

退出條件：

- 按 Milestone／Spec 組織 Ticket 進度，顯示依賴、來源問題、待接受結果及證據缺口。
- 區分歷史完成與目前來源有效性，不能把 done＋stale 當成未曾完成，也不能把它當成新需求已完成。
- 摘要可追溯至正式版本、Result 與 Acceptance；所有 Tickets done 不自動滿足 Milestone 的退出條件。
- 對量測中確認的問題回放同類情境，說明實際減少的重複步驟及仍需人工判斷的部分。

不包含：自動核准、Milestone 自動完成、完整 UI 或新增一套手動維護的進度狀態。

## Milestone 4：按實際需求恢復外部整合

**狀態**：暫緩。只有本機流程驗證後仍有明確的外部重複操作，且使用者選定 provider 與交付範圍，才恢復相關工作。順序不再固定為 Plane 全部完成後才做 GitHub。

保留能力邊界：

- Plane 已有 container、明確首次 export request、durable create／reconciliation 核心及單次 HTTP CLI。
- 已有 active mapping 的後續 content/status outbox、ordered sync plan、supersession、health、mapping termination 及歷史查詢。
- 已有明確單次 observation CLI、不可變 snapshot 與 Content Drift 歷史。
- 後續 update/status execution、Content Drift resolution、完整雙向狀態衝突處理與 GitHub adapter 尚未完成。Outbox 保存不等於外部已同步。

保留 [Spec #94](https://github.com/krok1029/ai-product-graph/issues/94) 及 [#95](https://github.com/krok1029/ai-product-graph/issues/95)／[#96](https://github.com/krok1029/ai-product-graph/issues/96)／[#97](https://github.com/krok1029/ai-product-graph/issues/97)，以新來源階層重訂採用與查詢驗收，維持未開工。這組工作只處理已保存差異的決策與草稿，不代表交付 outbound processor。

恢復時每份 Spec 交付一條完整可驗證的使用情境，保持以下約束：

- 外部 mutation／resolution tools 由 full 提供，core 不增加整合義務；啟動不自動發送請求。
- 首次匯出須使用者明確選擇；active mapping 的 durable enrollment 不因暫緩 roadmap 或切換 profile 被關閉。
- 外部內容先保存證據；涉及新需求時先更新上游規劃，再建立有效來源的候選 Ticket Revision。server 驗證結構與版本，不判定自然語言規格是否語意一致。
- 內容差異已處理、草稿已核准、實作已接受、外部同步成功是不同狀態。
- 保留並發保護、欄位 ownership、immutable history、逐 mapping 序列與失敗恢復；外部 done 不取代 Result Acceptance。

## 尚未排入交付

完整 Web UI、Hosted MCP、Postgres、embeddings、即時多人協作及其他 provider adapters。只有前述情境顯示現有方案不足時，再建立具體 Spec 與退出條件。
