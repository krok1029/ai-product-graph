# 本機收尾：工程證據與隔離協定回放

對應 [Ticket #121](https://github.com/krok1029/ai-product-graph/issues/121)／[Spec #118](https://github.com/krok1029/ai-product-graph/issues/118)。本次工程交付已具備可審查證據；正式使用者 Acceptance 仍保留到最後審查，**不關閉 #105，也不宣稱測試產品 Milestone 已完成**。

## 正式資料保持待審

本次透過正式 MCP 唯讀查詢三張 Ticket，隔離回放前後完整 work-context `data` 完全相同。查詢快照、逐份 canonical hash 與準則原文見 [工程證據 JSON](2026-09-28-local-closeout-engineering.json)。查詢時間是保存回應後的觀察時間，不冒稱 server 內部時間。

| 工作 | 核對狀態 | 下一步 |
| --- | --- | --- |
| 清單 r3 `01M3KCMHD2SGC50XFRV3A0WAPS` | current／planned，pending Result `01M3KD0E6ZT46X79XDDHKSCTB2`，六項證據無缺口 | 最後由使用者審查清單 Result |
| 篩選 r2 `01M3KCN5S62J4WEQ1K0MKC07G0` | current／planned，依賴清單，尚無新版 Brief／Result／Acceptance | 上游接受後，沿用既有產品與證據，建立有效 handoff 與自己的 Result |
| 獨立說明 r1 `01M3JY4YKBTV4V7YBZR77TXXKP` | current／done，原 Brief、Target、accepted Result 保留 | 不重做 |

正式 Project 沒有被本票寫入。`source_freshness=current` 不代表交付已完成；工程檢查、PR review、merge 都不等於使用者接受。查詢範圍是三份 work-context，不是全部歷史 Acceptance audit。

## #105 既有證據納入版本控制

來源 worktree 的差異僅包含兩份未追蹤檔案。本票原樣保存 [來源往返紀錄](2026-09-28-workflow-sorting-acceptance.md) 與其 [JSON](2026-09-28-workflow-sorting-acceptance.json)，不把其中歷史的「尚未提交」重寫成當時已提交。

重新核對全部 21 份原始檔案 bytes SHA-256 均符合原 JSON。內容往返後版本仍前進；舊 handoff 與真正 pending Result 的新 Acceptance 均遭 `STALE_HANDOFF/graph_node_changed` 拒絕，拒絕前後資料相等。清單與篩選必要 replacement 核准及清單新 Result 已有正式回應；這些既有操作沒有重跑。

原始來源在 `/private/tmp/apg-delivery-current/scenario-b-final/`。正式 JSON 保存必要投影與 hashes；並不宣稱公開投影可還原全部原始回應。

## 篩選七條準則的工程核對

產品 `/Users/limingfeng/Project/workflow-checklist` 仍是乾淨 commit `df6017401f752ea191cf6c1b2264c64b07ce67b3`。逐一重算 12 個 tracked files 的 hashes，均符合既有排序測試紀錄，因此沿用當時 20 項通過的規則／伺服器測試與桌面觀察；本次沒有重跑產品測試或重新操作桌面，也沒有產品改碼。

| 準則 | 工程證據及適用範圍 | 正式交付限制 |
| --- | --- | --- |
| ac1 初始／重整全部、鍵盤與選取標示 | 原篩選互動、排序重整紀錄；補充桌面紀錄逐一聚焦三個按鈕並 Enter 啟動 | 沿用真實歷史觀察，不宣稱本次完整 Tab 遍歷 |
| ac2 對應狀態、分組、同毫秒／時鐘倒退 | 新排序規則測試與排序桌面觀察；filter 保持 snapshot 順序 | 舊情境 A 的「全部新到舊」不適用新版，未沿用該排序判定 |
| ac3 即時移出與鍵盤焦點 | 規則測試；排序紀錄的未完成勾選；原篩選紀錄的已完成取消及焦點 | app.js bytes 相同，原未改互動可沿用 |
| ac4 各檢視新增與保存 | 規則與桌面資料；補充紀錄包含未完成新增、已完成隱藏及重整保留 | 無需建立重複產品實作 |
| ac5 空狀態、讀寫保護與提示 | 三種空狀態的歷史觀察、規則錯誤測試及未改 UI 呈現路徑 | 未注入瀏覽器讀寫錯誤；不把 Node 邊界測試說成桌面故障實測 |
| ac6 不改資料、不記選擇、說明不變 | 規則、重整與說明觀察；資料格式及 help markup hash 保留 | 未重新列舉全歷史交付；只核對已有 identities／來源 |
| ac7 規則、桌面證據及新 Result | 工程測試與桌面證據已備妥，相關 hashes 在 JSON | **部分完成**：篩選新版正式 handoff／Result／Acceptance 仍待清單接受；隔離 Result 不可替代 |

原適用性報告指出的兩項桌面紀錄缺口，已由 06:56:57–06:57:27 UTC 的歷史補充紀錄覆蓋：三個按鈕逐一 Enter，以及未完成檢視新增。它們不是本票新測量。證據來源、原產品 commit 與 SHA-256 列於工程 JSON。

## 可重跑的隔離協定證據

[回放腳本](../../scripts/validate-local-closeout.ts) 使用全新 `:memory:` SQLite、既有 synthetic fixture 與 in-memory MCP transport。沒有複製或打開使用者資料庫，也沒有寫入產品 repository。回放透過 core `get_work_context`、`start_implementation`、`submit_work_result` 與 `accept_implementation_result`；fixture 起點由既有 service helper 準備，不是完整 Product Brief → Spec 規劃流程回放。

```sh
node --import tsx scripts/validate-local-closeout.ts /Users/limingfeng/Project/workflow-checklist /tmp/local-closeout-replay.json
```

須使用已安裝相依套件且 SQLite ABI 相容的 Node 20。本次 Node v20.19.0。腳本要求產品工作目錄乾淨，讀取真實 HEAD 作為下游 snapshot baseline，並保存腳本 SHA-256、來源 commit、完整 MCP request/response 及時間。回放結果見 [協定 JSON](2026-09-28-local-closeout-replay.json)。JSON 的 `source_commit` 是回放當時的主專案基底；新腳本的精確版本由 `script_sha256` 固定。

驗證序列：

1. 上游只有 pending Result 時，下游回報 `complete_dependencies`，沒有 accepted Result。
2. `isolated-protocol-reviewer-not-user` 接受上游，下游變為 `implement`；原 dependency ID 仍存在。
3. 故意提供錯誤 baseline，`start_implementation` 回傳 `STALE_HANDOFF/repository_baseline_mismatch`，Brief 仍 draft；提供真實 clean product commit 後回傳 current。
4. 下游提交合成協定 evidence/Result 後為 `review_result`，accepted pointer 仍空；測試 actor 接受後才成 done。
5. 重試相同接受請求得到相同 receipt；兩筆 Acceptance 的 actor 均為測試 actor，dependency、Revision identity 保留，SQLite integrity／foreign keys 檢查通過。

fixture 原本的種子 actor `acceptance-user` 只是既有測試 helper 的合成名稱；這次兩筆接受皆明確屬於 `isolated-protocol-reviewer-not-user`。此回放沒有通過 UI criteria 的意思，合成 evidence 的描述也明確限定協定。

這補足了**另一次隔離的開工 baseline 檢查**。它不是新建立且沒有完整歷史的對話，因此 #104 歷史 C4 仍為 `not_triggered`，不能改寫成當時已通過。它也不消除正式清單／篩選目前的 pending／blocked。

## 成本、檢查與待審決策

協定 JSON 記錄完整回放起訖與有限區間耗時；這只含腳本運行，不含準備、文件、review、使用者或環境等待。歷史情境總耗時、有效工作、等待、重複確認及全歷史重複 artifacts 仍為 null。不得從測試數、工具數或這次短回放推導省時比例。

已執行回放、獨立腳本 TypeScript 檢查、JSON 解碼、21 份歷史來源 hashes、12 份產品 hashes、正式資料前後相等及差異格式檢查。開發時修正了三個可定位操作問題：補既有 node_modules 連結、fixture Repository 名稱相符、TypeScript 6 顯式檔案檢查加入 `--ignoreConfig`。這些是本票已知工程修正，不是使用者人工修正或全程錯誤總數。未為文件與隔離腳本重跑主專案完整測試。

本票暫定決策是保留正式依賴與產品接受語意，工程驗證先交付，最後審查再決定接受清單並解鎖篩選正常交付。不修改依賴規則來繞过最後審查。若使用者之後希望批次接受或允許工程完成即可開下游，應另定語意與規格，而非沿用這次隔離資料。

最後審查仍需：清單 Result 接受決定、解除依賴後篩選的新 handoff／Result／接受、正式資料最終狀態與父 Spec／Milestone 退出條件核對。正在執行的 live MCP loaded version 仍未知，本票磁碟基線與隔離 server 不替它背書。
