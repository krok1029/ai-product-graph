# 本機流程收尾：自主決策與最後審查

使用者授權：繼續實作到本機流程收尾，拆成多份 Spec／Ticket，無阻擋工作平行，另開 agents review PR，無問題即合併並繼續；中途不詢問，最後由使用者集中審查。本紀錄保存執行中的取捨，不假稱使用者逐項接受尚未看到的產品結果。

## 已由使用者決定的範圍

- 本機、單人使用；雲端、多人與其相關 Postgres 遷移退出目前完成條件。
- GitHub 由 agent 使用 `gh`，以既有 MCP 流程保存交付證據；專用 adapter 不列必做。
- 本輪止於本機流程工程收尾，Plane 後續同步與 Web UI 不開工。
- 自主工程實作、測試、獨立 PR review 與合併已授權；最後保留使用者審查。

## Agent 暫定決策

| ID | 決策與理由 | 不確定性／影響 | 使用者審查後如何調整 |
| --- | --- | --- | --- |
| D1 | 將工程收尾與正式 Result Acceptance 分開。維持 live 清單 pending、篩選 dependency blocked；使用隔離資料驗證下游流程。 | 無法宣稱 live 全部 Ticket done；完整 #105／#98 驗收尚留最後審查。 | 接受適用清單 Result 後，再依真實來源與 Repository baseline 完成篩選 handoff／Result／Acceptance；若不接受則保存修訂與新結果。 |
| D2 | 為 runtime 缺口提供專屬驗證入口，用固定建置複本、暫存 DB、profile 與 skills 指紋證明新 run。 | 不能追認舊 connector 的記憶體版本，shared dependencies 的證明範圍需明列。 | 若需要既有 connector 的自我辨識，再定義最小 handshake；此次不重啟使用者 connector。 |
| D3 | 在既有 graph context 中補 Milestone／Spec 的唯讀交付分組，不新增工具或手動階段狀態。 | 分组依資料來源與版本，不能推論自然語言退出條件是否滿足；新增欄位的 client 相容性需測試。 | 調整投影欄位或改由 client 整理，保留原 Ticket／規格／驗收資料。 |
| D4 | 保留歷史成本未知值；新 run 的時間只描述實際記錄區間。 | 尚無等價前後比較，不能證明節省百分比；舊訊息及等待時段無法補造。 | 若要量化效益，另跑有完整時間／決策記錄的等價情境。 |
| D5 | 保留原 dirty checkout 與已存在的未提交實作，在新 worktrees 交付。 | 原目錄仍不等於最新 main；已安裝 skills／connector 不因 PR 合併自動升級。 | 使用者審查後安排明確升級／工作目錄整理，先保留來源快照，避免覆寫。 |
| D6 | 子票／PR 的工程完成可獨立記錄；父 Spec 的產品驗收條件不能因子票全關閉而自動通過。 | Issue 的工程狀態與 live 產品交付狀態不同，摘要須清楚標示。 | 最後逐項審查父 Spec 與 Milestone，必要時修訂範圍或留下具體後續票。 |

## 執行與證據規則

GitHub Issues 是本 repository 規劃的正式來源，不為登記自身 roadmap 額外建立使用者 SQLite Project。Spec #116／Ticket #119、Spec #117／Ticket #120、Spec #118／Tickets #121–#122 構成目前無阻擋工作；彙整票 #123 需等成果才定稿。

每張票循環：依具體 Spec 實作 → 適用測試 → 提交確切 head → 新 agent 分別做 Spec 與 Standards review → 修正／重審 → 合併。Reviewer 不能審自己寫的變更。合併後的主分支另作整合驗證，失敗留紀錄並修正，不用放寬條件掩蓋問題。

正式使用者 DB 不作試驗性 acceptance、不刪除依賴、不直接改 SQLite。隔離測試中的 actor、結果、成本與真實使用者狀態分開保存；所有需要最終使用者決策的項目集中列在審查包，期間繼續其他可執行工程工作。
