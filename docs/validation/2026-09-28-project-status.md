# 專案進度與剩餘工作核對

2026-09-28，Asia/Taipei。收尾時再次核對 Issues／PR，納入 14:41:44 合併的 PR #114。依使用者要求更新落後的進度說明。本紀錄為當次查詢快照；GitHub 與使用者 Project 可繼續變動，後續操作應重新查詢。此次只更新文件，未修改產品資料、接受結果、重跑程式測試或同步本機程式版本。

> 後續狀態：本文件保留前次進度核對快照。#104 已於 06:51:40 UTC 關閉、PR #115 已合併；#105 清單已至 r3 待接受、篩選 r2 來源有效但依賴未完成。使用者後續授權自主工程收尾與最終集中審查，新增 Specs #116–#118；目前安排以 [roadmap](../08-roadmap.md) 及 [決策紀錄](2026-09-28-closeout-decisions.md) 為準，下方「三張剩餘工作票」不是目前即時票數。

## 來源與版本邊界

| 對象 | 核對結果 | 可以作出的結論 |
| --- | --- | --- |
| 首次核對的 GitHub main | `7d834d03d04454de15d503b0d66dc33f94c57021` | 已包含核心基線、差異處置、情境 A 與 B 原始影響紀錄 |
| 收尾核對的 GitHub main | `d9d85636a492ae4e72210cf46435b1a9a8be4e10` | 另已合併 PR #114 的排序修復與待接受接手檢查點 |
| 本機原工作目錄 | HEAD `372b43406e5fe34f2b139cbfab83461a2bb8161c`，有既有未提交變更 | 不能視為遠端 main 的乾淨副本；本次保留程式與使用者變更 |
| 連線中 MCP | `get_graph_context` 成功讀取當前資料 | 可以報告查得的資料；無法據此證明 process 載入哪一個 commit |
| 已安裝 skills | 先前驗證指出連到原工作目錄 | 不從遠端 PR 合併推定 skills 已升級；本次未重新採集其 hashes |

PR #99 的建置後介面探查為 core 23／full 43 tools。後續主分支 `core-stdio-workflow.test.ts` 已要求 core 23／full 46 tools，README 與工作流文件相符；新增三個是 Content Drift 拒絕、採用與處置查詢。Core 仍無 prompts，full 保留六個。這是已合併程式與既有驗證的核對，不是本次重新啟動服務的測量。

## 已完成與已合併

| 成果 | 證據 | 邊界 |
| --- | --- | --- |
| 本機規劃、實作與驗收基線 | [PR #99](https://github.com/krok1029/ai-product-graph/pull/99)，[#100](https://github.com/krok1029/ai-product-graph/issues/100) 已關閉 | 不代表後續真實 A／B／C 情境全通過 |
| 試用起點與量測方式 | [PR #108](https://github.com/krok1029/ai-product-graph/pull/108)，[#101](https://github.com/krok1029/ai-product-graph/issues/101) 已關閉 | 是當時 pending Results 的歷史快照 |
| 情境 A：新增篩選並沿用原交付 | [PR #112](https://github.com/krok1029/ai-product-graph/pull/112)，[#102](https://github.com/krok1029/ai-product-graph/issues/102) 已關閉 | 功能及 identities 驗證完成；完整成本與 runtime 來源仍有缺口 |
| 情境 B：真實排序變更與舊 handoff 拒絕 | [PR #113](https://github.com/krok1029/ai-product-graph/pull/113)，[#103](https://github.com/krok1029/ai-product-graph/issues/103) 已關閉 | 只完成影響檢查，尚非整段修復與新驗收完成 |
| Content Drift 拒絕 | [PR #107](https://github.com/krok1029/ai-product-graph/pull/107)，[#95](https://github.com/krok1029/ai-product-graph/issues/95) 已關閉 | 保存不可變決策，不寫回外部內容 |
| Content Drift 採用為候選草稿 | [PR #110](https://github.com/krok1029/ai-product-graph/pull/110)，[#96](https://github.com/krok1029/ai-product-graph/issues/96) 已關閉 | 不自動核准規格、接受實作或同步 Plane |
| 處置與歷史查詢 | [PR #109](https://github.com/krok1029/ai-product-graph/pull/109)，[#97](https://github.com/krok1029/ai-product-graph/issues/97) 已關閉 | Full-only 查詢，不啟動 provider／processor |

既有工程驗證分屬不同基線：PR #99 記錄 55 個測試檔／836 項測試；PR #109 記錄 63 個測試檔／989 項測試，兩者均記錄 Node 20、雙型別檢查、build 與 smoke 通過。此次沒有重跑，不能將其稱為本機目前工作目錄的新結果，也不由測試數推算覆蓋率或完成比例。

## 測試產品的當前狀態

Project「日常清單｜工作流驗證」：`01M3JXSN8AEP7243K15BFMV4EB`。本次唯讀 `get_graph_context` 回傳 Graph Revision `01M3KAEJYTHYBPHDWSHD0R3XDQ`，approved Brief 來源為 v3 `01M3KA12FFGP6P112NQ93N7WDT`。

| Ticket | 目前查得狀態 | 下一步 |
| --- | --- | --- |
| 清單操作 `01M3JY4YK7TQWT4A4X03W2CF4Y` | replacement revision `01M3KAJCA9NHJQC6SFV0EXG1NK` 為 current；delivery `planned`；已有 pending Result `01M3KBBTAVGSQ1EAT5YKGY7GWY` | `review_result`，按接手驗證排程保留待接受 |
| 獨立說明 `01M3JY4YKBVSWSNGTFWWV5Y2DJ` | done／current，沿用 accepted Result `01M3K097JXX36TDET2SCJ2F738` | `done`，不重做無關工作 |
| 篩選 `01M3K93WX6A48WS4YZMPW88CMQ` | 歷史 done／目前 stale；依賴清單而 blocked；保留 accepted Result `01M3K9WBNDZXJ5Y7NFXZK8BQYN` | `reconcile_sources`，接手後處理受影響規格與交付 |

Summary：total **3**、done **2**、stale **1**、blocked **1**、awaiting_acceptance **1**。這些維度重疊；不能相加當成 Ticket 總數，也不能把兩張 done 都視為符合新規格。清單 pending Result 的 `criteria_without_evidence` 與 `unsatisfied_criterion_ids` 均為空，不等於已取得使用者 Acceptance。

情境 A 的初版清單與說明於 05:42 UTC 接受，篩選於 06:06 UTC 接受，詳見 [已合併情境 A 紀錄](https://github.com/krok1029/ai-product-graph/blob/7d834d03d04454de15d503b0d66dc33f94c57021/docs/validation/2026-09-28-workflow-filter.md)。後續排序變更造成的 stale 不抹去這些歷史接受。新的排序結果與接手快照由 [PR #114](https://github.com/krok1029/ai-product-graph/pull/114) 保存；該 PR 已於 06:41:44 UTC 合併，#111 已關閉。這完成的是檢查點紀錄交付，產品排序 Result 仍未接受。

## 剩餘工作與完成邊界

### 已拆票的近期工作：3 張工作票

前置 #111 已完成排序修復與待接受接手檢查點，PR #114 已合併。以下順序是目前 #98 的剩餘驗證安排，不是自動執行或接受結果的指令。

| 順序 | 工作 | 核對時狀態 | 還需要完成什麼 |
| --- | --- | --- | --- |
| 1 | [#104 無完整聊天歷史的新對話接手](https://github.com/krok1029/ai-product-graph/issues/104) | OPEN，前置 #111 已完成 | 真正新任務從持久資料辨識狀態、沿用已有 artifacts，保存比對與成本；本次查進度不冒稱已完成此驗證 |
| 2 | [#105 修復受排序影響的工作](https://github.com/krok1029/ai-product-graph/issues/105) | OPEN，需先完成接手 | 驗證來源往返後舊 handoff／pending Result 的新 Acceptance 被拒絕；必要 replacement、重新驗證、篩選修復與使用者驗收；保留無關說明及歷史接受 |
| 3 | [#106 正確性與管理成本彙整](https://github.com/krok1029/ai-product-graph/issues/106) | OPEN | 逐條彙整 A／B／C 證據與真實成本、保留未量測限制、列出缺口，供使用者決定下一階段 |

另有 **2 張 OPEN 父 Spec**：

- [#98](https://github.com/krok1029/ai-product-graph/issues/98)：等待上述驗證及父層退出條件，不把父 Spec 再計為一套功能實作。
- [#94](https://github.com/krok1029/ai-product-graph/issues/94)：三張子票已合併關閉，但父文仍寫暫緩與未完成清單，需要對照子票證據核對父層驗收及更新追蹤。本次沒有自行關閉或改寫該 Spec。

### 本機產品後續收尾

原本本機 MCP MVP 核心能力已交付；若以「可持續開發、可靠接手並能清楚說明進度」為這輪完成邊界，還需要上述 3 張工作票及以下退出條件：

- 解決或明確保留實際 MCP runtime／skills 版本來源的不確定性；不能把遠端 main、磁碟程式與正在執行的 process 混為一談。
- 根據 #106 決定 Milestone 3 的必要改善與驗證範圍。現有查詢已能表達多個狀態，不代表已完成按 Milestone／Spec 的說明及同類情境回放。尚未拆票，工作量待實際缺口確定。
- 以證據核對父 Spec／Milestone 的退出條件，讓當前入口文件保持一致。歷史驗證保留原始狀態，附新紀錄連結，不覆寫成新結果。

這些不是三張工作票之外已核准的新功能清單；部分可在現有票內完成，額外實作需按觀察到的問題定義。沒有同類比較 run 前，不宣稱已節省某個比例的時間。

### 目前保留的 2 類擴充，未全部拆票

2026-09-28 後續範圍決策：使用者要求先移除雲端與多人版本。Hosted MCP、多人身分／權限／協作與相關 Postgres 遷移不再計入剩餘工作或完成条件；目前以本機、單人使用為邊界。下列外部整合不要求將 AI Product Graph 部署到雲端。

同日後續決策：GitHub 專用整合亦移出必做清單，不計入專案完成條件。Agent 用 `gh` 處理 GitHub，再按既有契約保存 PR／commit 證據與 Result 引用；這不表示已提供自動 Issue mapping、檔案圖譜抽取或背景同步。僅在實際流程出現可重現的漏記、重複操作或同步需求時另立最小補強，詳見 [整合策略](../07-integrations.md#github)。

| 類別 | 尚缺能力 | 範圍狀態 |
| --- | --- | --- |
| Plane 完整同步 | 後續內容更新、close／reopen 執行、雙向狀態及衝突處理、實際 provider 使用情境驗證 | 已有保存義務及觀測基礎，但完整執行未交付 |
| 本機 Web 管理與圖譜介面 | 選定的瀏覽、查詢、規劃及進度互動 | 未開始，待既有對話介面的真實缺口決定；不包含雲端多人服務 |

Embeddings 與其他 providers 仍屬可選方向，不預設為「完成」必做項目。上述兩類大小不同，不能當成兩張等量任務。擴充範圍沒有完整規格與工期基準，因此目前能可靠報告的是「本次進度快照的三張已拆工作票＋待驗收／依缺口決定的收尾」，不能給整個專案一個有依據的百分比或完工日期。

## 更新方式

當目前狀態改變時，先查 GitHub Issue／PR 與 live delivery，再更新 README、roadmap 的當前摘要並附證據。原 `workflow-baseline`、`workflow-start`、`workflow-filter`、`workflow-sorting-impact` 等驗證檔是歷史快照，其數字與狀態不跟著新版重寫。PR 合併、工具存在、測試通過、產品 Result Acceptance 與 Milestone 完成必須分開表達。
