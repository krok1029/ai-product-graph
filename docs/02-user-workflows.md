# 使用者工作流

預設由 `ai-product-plan`、`ai-product-implement`、`ai-product-accept` 三個 skills 操作本機 MCP。使用者表達需求、確認具體規格並接受結果，agent 保存正式資料。欄位契約見 [精簡工作流](22-skill-led-workflows.md) 與 [階層規劃](23-planning-hierarchy.md)。

## 1. Idea → Product Brief

1. 沿用或建立 Project，保存原始 Idea；Project 與 Repository 分別管理。
2. 只釐清會影響範圍的問題，區分已知事實與假設。
3. 整理完整 Product Brief draft，展示目標、範圍、non-goals 與具體版本。
4. 使用者同意後核准；core 同時更新圖譜根節點，不另要求圖譜核准。

## 2. Product Brief → Milestone → Spec → Ticket

1. 先展示主要 Milestones 的成果、順序、範圍與退出條件。
2. 在已授權規劃範圍內保存 Milestones，再將各階段拆成 Specs，描述問題、方案、使用者故事、實作及測試決策。
3. 保存 Milestone／Spec 時自動更新圖譜關係與版本；遇到 base conflict 先重讀，不盲目重試。
4. 從 Spec 拆成可獨立展示或驗證的垂直切片 Tickets，列出驗收條件、依賴、non-goals 與 Repository targets。
5. 展示具體 Ticket drafts；使用者可一次同意多張，agent 保存各自核准。規劃完成不代表已授權開始實作。

## 3. Ticket → 實作

1. 取得工作上下文，確認來源、依賴、Repository、既有計畫、已接受與待接受結果。
2. 檢查真實程式碼 baseline，整理並保存精簡 Implementation Brief。
3. 使用者已授權實作 approved Ticket 時，同範圍計畫直接沿用授權；只有缺少授權或實質變更才補足同意。
4. 呼叫 `start_implementation` 驗證來源與 Repository baseline，通過後修改程式並驗證。
5. 保存真實執行的測試、變更與產物參照。PR／部署依此次交付範圍決定，不是每張 Ticket 的必要動作。

## 4. 實作 → 驗收

1. 有適用的待接受 Result 時沿用；否則一次提交 evidence、逐 criterion verdict 與候選 Result。
2. 展示達成條件、未完成項目與證據，讓使用者試用或審查。
3. 對具體結果取得接受決定後保存 Acceptance；未滿足條件的 waiver 必須有使用者指定的項目與理由。
4. 所有 required targets 具有效 Acceptance 才能完成 Ticket。新需求保留有效歷史驗收；原 Acceptance 無效且使用者要求撤銷時才走 Revocation。

## 5. 新需求或回饋 → 規劃變更

1. 判斷影響的是產品方向、階段成果、能力規格，或既有 Spec 內的工作細節。
2. 需要改 Product Brief 時建立並核准新版；依變更範圍更新 Milestone／Spec。回饋本身不直接改寫 approved 規格；專用 feedback ingestion 是後續能力。
3. 讀取圖譜影響清單，從上游重新比對。仍適用的 Spec 保存相同內容以確認來源，保留內容版本。
4. 再查影響清單。來源恢復有效的既有 Ticket／Brief／Result 可沿用；真正改變的 Spec 或其他來源才修訂受影響 Ticket。新增能力另建 Spec／Ticket，保留有效歷史 Acceptance。
5. 不把 root 已同步當成所有下游已確認，也不為了清除 stale 重建全部工作。

## 6. 新對話接手與進度查詢

1. 查詢 Project 與圖譜，依 Milestone → Spec → Ticket 說明目前規劃。
2. 使用 `delivery` 診斷已完成、來源過期、依賴阻塞、證據缺口與待接受結果；全專案 summary 不受圖譜節點 filter 縮限。
3. 對準備接手的 Ticket 讀取完整工作上下文，說明下一步；已有 pending Result 時先審查，避免重複提交。
4. 跨對話不假設聊天中的實作授權仍可證實；沿用可查證的正式紀錄與現有明確授權，缺少時只補足必要決策。
5. 階段進度可先由 agent 整理現有資料。不能只以 Ticket 全部 done 自動宣告 Milestone 退出條件達成。

## 相容與選配

`full` 保留未採用階層舊專案的 graph draft／approval 及六個 MCP prompts；已採用階層的專案仍遵守新來源規則。切換 profile 不會自動遷移規劃資料或啟動外部 processor。

外部匯出由使用者明確觸發。外部內容的採用需先判斷是否超出現有 Spec，再以有效來源建立候選 Ticket Revision；相關工具尚待 #94–#97 交付，不能視為目前可用工作流。
