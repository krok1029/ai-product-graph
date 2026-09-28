# 持續開發驗證：版本基線與起點

> 歷史快照：以下保留當時的版本、測試及待接受狀態。後續 PR #99 已合併核心基線，初版兩份結果與情境 A 篩選已接受，情境 B 已進入排序修復待接受檢查點。最新狀態與來源見 [2026-09-28 進度核對](2026-09-28-project-status.md)。不要將下文「未提交」「尚未接受」「A／B 未開始」讀成目前狀態，也不要把當時 full 43 tools／836 tests 改成後續版本的數字。

2026-09-28，依使用者「繼續往下做」執行 [Spec #98](https://github.com/krok1029/ai-product-graph/issues/98) 的前置檢查。本紀錄不代表 A／B／C 的實際使用情境已通過，也不代表測試產品已驗收。

## 可重現基線

- Git commit：`372b43406e5fe34f2b139cbfab83461a2bb8161c`，branch：`main`。
- 測試對象包含尚未提交的工作目錄變更，不是僅測該 commit。
- 305 個 tracked／未忽略 untracked files 的 SHA-256 manifest 指紋：`b2de889a0c437aa7d6b2b067b185bba3345a21241f47a1d219195d99d99f592d`。
- 原始內容快照、逐檔 manifest、dirty status、完整 log 與時間記錄保存在本機 `tmp/validation/20260928T023344Z/`；此目錄為 Git 忽略的驗證產物，須保留才可重現當時工作目錄。它不包含 node_modules、使用者 SQLite 或環境機密檔。
- 原始快照 `source-baseline.tar.gz` 附有 `source-baseline.sha256`；執行測試、建置與 profile 探查後核對原 manifest，305 個檔案內容均未改變。此報告與 roadmap 狀態更新發生在驗證之後。
- Runtime：Node `v20.19.0`、pnpm `10.17.0`；目前 shell 的預設 Node 是 24，本次明確使用現有 SQLite native dependency 可運作的 Node 20。
- 三個已安裝 skills 均指向本 repository 的 `skills/ai-product-plan`、`skills/ai-product-implement`、`skills/ai-product-accept`，內容指紋已納入 manifest。

## 檢查結果

| 指令 | 結果 | 實際 wall time |
| --- | --- | --- |
| pnpm test | 通過 | 9.861 秒 |
| pnpm typecheck | 通過 | 0.485 秒 |
| pnpm typecheck:ts6 | 通過 | 1.692 秒 |
| pnpm build | 通過 | 2.163 秒 |
| pnpm smoke | 通過 | 0.344 秒 |

完整測試為 **55 個檔案、836 項通過**。初次在受限執行環境中有 34 項因 `listen EPERM 127.0.0.1` 失敗，其餘 802 項通過；允許本機模擬 HTTP 連線後重跑全套即通過。保留兩次 log，未修改程式來迴避測試，也未呼叫真實 Plane API。未執行 coverage，不能由通過數推導覆蓋率。

另以建置後的 `dist/index.js`、各自全新暫存 SQLite 啟動真實 stdio client：core 23 tools／0 prompts；full 43 tools／6 prompts。結果見 `profiles.json`。這確認新啟動服務的介面，不代表其他已存在的 MCP process 已自動重啟。

## #98 的實際使用起點

- 新 Project：日常清單｜工作流驗證，ID `01M3JXSN8AEP7243K15BFMV4EB`。
- 新 Idea：`01M3JXT488Z3CXGG5Y17RSYWD6`，區分使用者繼續指示與 agent 提議的測試產品。
- Product Brief v1：`01M3JXW0DN8A9EYA4GA7F516A7`，使用者已於本對話確認並保存 approval。
- 範圍：本機繁中桌面待辦網頁，新增非空白項目、勾選／取消完成、初版新到舊排序、瀏覽器持久化及獨立操作說明。無登入、雲端部署、手機驗證。
- 規劃中的後續情境：新增篩選以驗證既有交付沿用，再改排序以驗證影響範圍，最後以新對話接手。必須按實際規格與結果取得對應決策。
- Repository：`01M3JY1DNY41ABJ8WTZ1F9M0XN`，實際目錄 `/Users/limingfeng/Project/workflow-checklist`；初版產品已實作。
- Milestone：`01M3JY37R2X5SCFQY52DDYNN2Y`（可用且可驗收的本機清單）。
- 清單 Spec：`01M3JY3DHYFY20WX92JYBQJNPG`；說明 Spec：`01M3JY3JVHS4VMMPRCJMW4SPWY`。
- 清單 Ticket：`01M3JY4YK7TQWT4A4X03W2CF4Y`／Revision `01M3JY4YK8HSMSNNS7HAXJ21A7`。
- 說明 Ticket：`01M3JY4YKBVSWSNGTFWWV5Y2DJ`／Revision `01M3JY4YKBTV4V7YBZR77TXXKP`。
- 兩張 Tickets 已合併展示，使用者回覆「ok 那繼續往下做」後核准並開始實作。同範圍技術計畫沿用此授權，未額外要求確認；兩張沒有相依工作。
- 原已刪除的試用專案未恢復。

## 初版實作與待接受結果

- 新專案的真實起始 commit：`a4698769dabe20eccbc2cb8bb45ff58d6951c8cf`（空 repository baseline）。產品程式碼目前為未提交的新增檔案，未推送或部署。
- 清單 Implementation Brief：`01M3JZTV0R0RYXD1ZF6CAVRVB3`；說明 Implementation Brief：`01M3JZTZR6S7RS3FB26P5ZHZX3`。兩者開工時均通過 `freshness: current`。
- 本機頁面：`http://127.0.0.1:4178/`；原生 HTML/CSS/JS 與 Node 本機伺服器，不需安裝依賴。
- `npm test` 於 2026-09-28T03:13:48.425Z–03:13:48.823Z 執行，11 項全部通過；另通過程式語法與 diff 空白檢查。
- 桌面瀏覽器實測於 03:14:21.060Z–03:15:35.986Z 執行：空白拒絕、trim、純文字標記、新到舊、完成／取消、重新整理保持身份與狀態、空清單說明、Enter／Space 開關、說明前後及重整後資料一致。未驗證手機或跨瀏覽器。
- 儲存失敗／損壞邊界以 Node 測試驗證，未在使用者瀏覽器注入損壞。實測過程修正一次不受支援的 DOM 檢查方法，並以原生鍵盤與 `open` 屬性確認說明開關；未修改產品來規避檢查。
- 原始碼快照、逐檔雜湊、測試 log、桌面紀錄保留在新專案 `evidence/`（Git 忽略）。快照 SHA-256：`03d2a925a59a76dd80c350c2d84bd95626ca8f8b86fa022cc8bc9772caba58d6`。
- 清單 Result：`01M3K093HMFYYMCPV98D747EV2`，6 條 criteria 均有對應證據；說明 Result：`01M3K097JXX36TDET2SCJ2F738`，3 條均有對應證據。
- 兩份 Result 均為 `reviewable`，沒有未完成項目；尚未取得使用者 Acceptance，Ticket 不宣稱 done。接受後才具備後續 A 情境起點。

## 情境驗證狀態

| 情境 | 狀態 | 真實操作成本 |
| --- | --- | --- |
| A 新增能力／沿用交付 | 未開始，尚無已接受的基礎功能 | 未量測 |
| B 修改規格／影響範圍 | 未開始 | 未量測 |
| C 跨對話接手 | 未開始 | 未量測 |

上述檢查耗時是工程基線，不能當成使用者完成 A／B／C 的時間，也不能宣稱已降低管理成本。後續記錄依 #98 分開統計必要決策、重複確認、等待時間、人工修正及重複 artifacts。
