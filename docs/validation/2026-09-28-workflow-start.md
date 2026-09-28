# 持續開發試用起點與量測方式

本紀錄交付 [#101](https://github.com/krok1029/ai-product-graph/issues/101)，供 [#98](https://github.com/krok1029/ai-product-graph/issues/98) 後續 A／B／C 使用。Run ID：`workflow-start-20260928T051818Z`。這次僅讀取正式資料及 Repository；沒有核准、接受、重送 Result 或改寫測試產品。

## 正式資料起點

2026-09-28 **05:18:18.383Z–05:18:43.779Z** 依序執行 `get_project`、`get_graph_context(max_depth=5)` 及兩次 `get_work_context`。四次均成功；這是連續查詢，並非跨查詢的原子快照。精確參數、各次 UTC 起訖、回應內容雜湊及必要欄位保存在[查詢快照](2026-09-28-workflow-start.json)。

- Project：`01M3JXSN8AEP7243K15BFMV4EB`（日常清單｜工作流驗證）。
- Product Brief：`01M3JXW0DN1A75X6VFKKX3JHGJ`；approved v1：`01M3JXW0DN8A9EYA4GA7F516A7`。
- Graph Revision：`01M3JY3JVH3D2EPE6ZNAM7H071`；root：`01M3JY14RZ5CYZCQNJZVERVJTC`。
- Milestone：`01M3JY37R2X5SCFQY52DDYNN2Y`；內容版本：`01M3JY37R234AMMBHC1H4T2FKA`。
- Repository：`01M3JY1DNY41ABJ8WTZ1F9M0XN`。

| Identity／狀態 | 清單操作 | 獨立說明 |
| --- | --- | --- |
| Spec | `01M3JY3DHYFY20WX92JYBQJNPG` | `01M3JY3JVHS4VMMPRCJMW4SPWY` |
| Spec 內容版本 | `01M3JY3DHY9YTTVFR8S29Y7S8K` | `01M3JY3JVH3D2EPE6ZNAM7H071` |
| Ticket | `01M3JY4YK7TQWT4A4X03W2CF4Y` | `01M3JY4YKBVSWSNGTFWWV5Y2DJ` |
| approved Ticket Revision | `01M3JY4YK8HSMSNNS7HAXJ21A7` | `01M3JY4YKBTV4V7YBZR77TXXKP` |
| Implementation Target | `01M3JZS32J1PG41ZYQPHYMP3S2` | `01M3JZS7NP4Z74DCXM0J1N73HV` |
| approved Implementation Brief | `01M3JZTV0R0RYXD1ZF6CAVRVB3` | `01M3JZTZR6S7RS3FB26P5ZHZX3` |
| pending Result | `01M3K093HMFYYMCPV98D747EV2` | `01M3K097JXX36TDET2SCJ2F738` |
| Result review／disposition | `draft`／`reviewable` | `draft`／`reviewable` |
| accepted Result | `null` | `null` |
| 有效 Acceptance identity | 無可沿用的有效接受；未取得 ID | 無可沿用的有效接受；未取得 ID |
| delivery／source freshness | `planned`／`current` | `planned`／`current` |
| 依賴／阻塞／證據缺口 | 均為空陣列 | 均為空陣列 |
| next action | `review_result` | `review_result` |

Graph 查詢為 active Project 全部 Tickets：total **2**、done **0**、stale **0**、blocked **0**、awaiting_acceptance **2**；planning 的 stale nodes 與 affected Tickets 均為空。這些是查得的狀態數量，不是未執行情境的量測值。`get_work_context` 沒有回傳有效 accepted Result；本次沒有另外宣稱查遍所有歷史 Acceptance／Revocation。不得把 `reviewable`、無證據缺口或 GitHub PR 合併視為產品接受。

## 分開保存兩種程式基線

以下於 **05:19:10Z** 只讀取得，逐項資訊在查詢快照的 `repositories`。指紋是當時工作檔案，不等於 HEAD tree 或既有原始碼壓縮檔的 SHA。

| 對象 | 真實 HEAD | 未提交內容／manifest SHA-256 |
| --- | --- | --- |
| 本次主 repo 隔離工作目錄，branch `codex/workflow-measurement-start` | `97e92755a470974e842475bf0857267de50fbfee` | 報告寫入前 307 entries；唯一 untracked 為本機 `node_modules` symlink；`d69169ed1e06e29e112c2c8d7ae9515ae753c46353a16c01b78e4a7225f55bb2` |
| 原主 repo 工作目錄（保持不動） | `372b43406e5fe34f2b139cbfab83461a2bb8161c` | 306 entries，89 筆 dirty status；`d66dce307010c09eb4a998264b2ce462238008952014b8ddba566456aa26ee8f` |
| 測試產品 `/Users/limingfeng/Project/workflow-checklist` | `a4698769dabe20eccbc2cb8bb45ff58d6951c8cf` | 9 個 untracked 原始檔；`793e99e81f17afeb1ce72274f0a1e575b270b5918f04a5b5b6096e77528a550a` |

測試產品的 Git remote names 為空，正式 Repository 的 `remote_url` 亦為 `null`；本票沒有新增 remote 或發布產品程式。9 個檔案的路徑、類型、逐檔 SHA 均保存在快照，可逐項比對，不包含被忽略的 evidence、瀏覽器資料或 SQLite。

已安裝三個 skills 的實際 symlink 目標與 SHA 在 `installed_skills`。它們指向原主 repo，不能由本次 PR head 推定已安裝版本。先前 **core 23 tools／0 prompts、full 43 tools／6 prompts** 的探查只適用[既有基線紀錄](2026-09-28-workflow-baseline.md)；本次未重啟或重新探查 MCP，**連線中 process 的 commit／profile 未驗證**。開始正式情境前必須固定並核對實際啟動的系統版本、profile 與 skills，不能把 97e9275 或原目錄 HEAD 冒充目前 MCP process 的版本。

### 重現與保存方式

1. 使用快照中的 tool 名稱對應（project → `get_project`、graph → `get_graph_context`、其餘 → `get_work_context`）及 `args` 重新查詢；比對 identities、來源版本、pending／accepted 與 dependencies。資料若已變動，保存新的 run，不覆蓋本起點。四次原始回應另留本機 `/tmp/apg-delivery-current/measurement-queries.json`。
2. `response_data_sha256` 與 planning node 的 `content_sha256`，分別對原回應的 `data`／節點 `metadata.content` 使用 Python `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')` 後計算 SHA-256。這是本紀錄的 JSON 序列化規則，不宣稱為 domain 的 RFC 8785 evidence hash。公開快照只保存必要投影，完整回應雜湊供本機原始回應核對，不能只由投影還原全文。
3. Repository manifest 從 `git ls-files -z --cached --others --exclude-standard` 取得路徑，依原始路徑 bytes 排序去重；每筆依序為 `path`、`kind`、`sha256`。普通檔案雜湊原 bytes；symlink 雜湊連結目標文字的 UTF-8、不讀目標；tracked 缺失檔案使用 `kind=missing` 與空 bytes。entries 以 Python `json.dumps(entries, ensure_ascii=False, separators=(',', ':')).encode('utf-8')` 後再取 SHA-256。完整主 repo manifest 留本機 `/tmp/apg-delivery-current/measurement-repositories.json`；它與產品 manifest 使用同一規則。
4. 本次公開 JSON 檔案 bytes SHA-256：`de1744fa7ec4e0e472158e4c69c7267c192378ff24d9db4acefc0d0bf27212a9`。可用 `shasum -a 256 docs/validation/2026-09-28-workflow-start.json` 核對。這些雜湊只能驗證內容；本機暫存原始回應若刪除，公開投影仍可核對 IDs，但不能重建完整舊回應。正式情境開始前將其留存於受控證據位置。

## 情境前置與量測規則

目前 A／B／C **均未開始、所有成本欄位未量測**。這次四次查詢的時間只屬於起點採集，不是 A／B／C 總耗時。A 缺少基礎功能的有效 Acceptance 及新增功能具體決策；B 缺少真正變更、明確受影響依賴與無關對照的起點；C 缺少可區分的 done／stale／blocked／pending 檢查點及符合規格的新對話。已有 pending Result 應沿用審查，不重新提交。每次執行前重新查來源，不能把本文件當作最新狀態。

| 欄位 | 記錄與判定 |
| --- | --- |
| run identity／起點 | scenario、run ID、UTC、系統 commit＋dirty manifest、實際 process/profile、三個 skills hash、產品 commit＋dirty manifest、Project／來源與交付 IDs；不同起點另立 run。 |
| 開始／結束、總耗時 | 開始於具體情境要求提出的可定位訊息；結束於該情境預定終點具足證據與必要決策的時刻。A 對照保留 IDs 並交付新增能力；B 完成影響阻擋與有效修復接受；C 完成新對話辨識與適用下一步驗證。中途停下記錄未結束，不以文件完成代替。 |
| 等待時間、有效工作時間 | 每段等待記錄起訖、原因（使用者／環境）、訊息或執行引用。重疊等待取區間聯集；有效工作時間＝總耗時減可定位等待。缺少時間證據就寫未量測，不從 token／工具呼叫數推估。 |
| 必要決策 | 每筆保存 decision ID 或訊息引用、對應版本與新資訊；包含新 Brief／Ticket、實質範圍變更、尚未授權的實作與 Result 接受。同一回覆涵蓋多版本記為一次決策事件，列明全部版本。 |
| 重複確認 | 內容未變且既有授權可查證，卻再要求同意；保存原授權及重複詢問的兩端引用。不能把本來就缺少的 Result 接受算作重複確認。 |
| 人工修正 | 使用者糾正 agent 對既有資料、關係、狀態或流程的錯誤；保存原錯誤與修正訊息。正常新增需求不算。 |
| 重複 artifacts | 列出舊／新 IDs、建立原因及有無實質變更；不需要的重建才計次，必要 replacement 保留但不算重複。 |
| 正確性與比較 | 對 #98 各條驗收列 pass／fail／未執行及證據引用；成本另列。未量測填「未量測」，不填 0。之後僅比較等價起點的真實 run，環境／範圍差異說明不可比，不宣稱目前已降低成本。 |

本票只檢查文件、JSON、雜湊與查詢對照；未重跑 836 項產品測試，也不把既有測試結果延伸成本票的新驗證。其 PR／review 只交付此起點紀錄，不完成 #98、測試產品 Ticket 或 Milestone。
