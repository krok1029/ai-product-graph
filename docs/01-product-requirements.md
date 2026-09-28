# 產品需求

## 目標使用者與價值

初期服務使用 AI coding agent 持續開發產品的 solo builder、indie hacker 與小型產品團隊。產品要保存需求、決策、實作與驗收的關係，讓需求改變或換對話接手時仍能掌握進度。

單次生成 Tickets 並不足以證明價值；流程必須減少重複解釋、重做與人工管理。產品經理、技術型創辦人及顧問團隊是後續使用者，尚不因此引入多人權限或團隊排程。

## 核心 Jobs To Be Done

1. **釐清方向**：從原始 Idea 整理 Product Brief，分清事實、假設、MVP 範圍與 non-goals。
2. **分階段交付**：依 Product Brief → Milestone → Spec → Ticket 拆解；Milestone 定義成果與退出條件，Spec 說明能力，Ticket 是可獨立驗證的垂直切片。
3. **理解變更影響**：知道哪些規格需要重新比對、哪些工作真正受影響，以及哪些既有交付仍可沿用。
4. **接續實作**：新對話或 agent 能取得目前規格、Repository、依賴、計畫、待接受結果與證據，不靠聊天記憶猜測。
5. **確認交付**：逐項連結驗收條件與證據，保留使用者接受、豁免與撤銷的決策。

## 目前本機 MVP

- 本機 stdio MCP、SQLite 持久化、Project／Repository identities 與 Idea 保存。
- Product Brief 與 Ticket Revision 的不可變版本及對話核准。
- Milestone／Spec 保存、自動圖譜同步與來源變更診斷。
- 三個 skills 編排規劃、實作、驗收；預設 core 提供 23 個 tools，full 相容模式提供 45 個 tools 及六個舊 prompts。
- 工作上下文、真實 Repository baseline 檢查、Implementation Brief 與 handoff。
- Observed Evidence、Implementation Result、Result Acceptance／Revocation 及跨重啟查詢。
- 圖譜、trace 與 Ticket 交付診斷：依賴阻塞、來源過期、證據缺口、待接受結果及下一步。
- 按需匯出 Markdown；對話操作不要求每一步另製文件。

「已實作」不等於已證明節省管理成本。下一階段依 [roadmap](08-roadmap.md) 驗證持續開發及跨對話接手，再依實際缺口補能力。

## 核准與來源規則

- Product Brief／Ticket 新版本仍需使用者對已展示具體內容的同意，可一次涵蓋多份明確草稿。
- Milestone／Spec 在已授權規劃範圍內自主保存並同步圖譜，不增加獨立 graph approval。舊 full 專案才保留手動 graph batch 流程。
- 已明確授權實作 approved Ticket 時，同範圍技術計畫沿用授權；實質範圍、Repository target 或風險變更需取得缺少的同意。
- 新 Result 的 Acceptance 是獨立決策；測試通過、工具成功或外部工作項目關閉都不等於內部 Ticket 完成。
- 上游改變後先重新比對來源鏈。Spec 內容版本未變且其他來源仍有效時，沿用原 Ticket、Brief 與驗收；真正內容或歸屬變更才修訂受影響工作。
- done 與 stale 可以並存：保留歷史完成紀錄，同時指出目前來源待確認。Milestone 的退出條件不能僅以 Ticket 數量或全部 done 推定成立。

詳細契約以 [階層規劃](23-planning-hierarchy.md) 與 ADR0039–0041 為準。

## MVP 非目標與選配能力

- 即時多人協作、複雜權限、付費、人力負載、工時與完整 sprint planning。
- 原生 code editor、完整 Web UI 或互動式圖譜管理介面。
- 取代 GitHub、Plane、Linear 等既有工具。
- Server-side LLM、內建 coding agent、Hosted MCP、Postgres 或 embeddings。
- 預設啟動外部同步、強制建立 PR／部署，或為了流程而增加中間文件。

Plane 已有部分匯出及觀測能力，完整 update/status execution、差異處理與 GitHub adapter 仍屬選配後續工作。保留已完成能力與資料契約，但不把外部整合完成當成本機 MVP 的必要條件。

## 後續驗證要求

- 新增需求後，未變的功能不重建交付或重新驗收。
- 實際修改規格後，準確阻擋過期來源並指出受影響工作；未受影響工作可繼續。
- 在新的對話中接續同一專案，能辨識已完成、待接受、阻塞與下一步。
- 記錄每個情境的耗時、使用者決策與重複確認、人工修正及重複建立 artifacts 的次數。先建立基準，再做同類情境比較，不以 tool-call 數或自動測試數代替產品成效。
