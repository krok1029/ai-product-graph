# 情境 C：新任務唯讀接手

本紀錄對應 [#104](https://github.com/krok1029/ai-product-graph/issues/104)，銜接 [#111 的排序待接受檢查點](2026-09-28-workflow-sorting-handoff.md)。Run ID：`workflow-fresh-handoff-20260928`。**真正的新任務已完成唯讀接手，能判讀既有關係、交付與下一步，並沿用原 identities；接手前後四組正式資料完全相同。C4 的實作 baseline 檢查未觸發，不能列為已實測通過。**

## 授權、輸入與真正的新任務

使用者明確回覆「同意建立新任務驗證接手」。主流程使用 projectless 建立新任務「驗證日常清單跨任務接手」`01a0e6bf-d80f-7172-bede-b972e2d186e9`（local host），不是繼承完整歷史的 reviewer。主專案基底為 #114 合併 commit `d9d85636a492ae4e72210cf46435b1a9a8be4e10`。

`task-create.json` 保存精確初始 prompt 與建立回應；建立前時鐘觀察為 **2026-09-28 06:42:02 UTC**。輸入只提供 Project `01M3JXSN8AEP7243K15BFMV4EB` 及正式唯讀查詢指示，要求自行找出 Milestone／Spec／Ticket、交付與来源／依賴、既有計畫和待審結果，不提供預期狀態。明確禁止參考其他任務聊天或既有驗證文件，以及修改、重提或接受資料。

單一 turn `01a0e6bf-d9b7-79a2-8554-992dd17f288d` completed，app 回報開始 Unix 秒 `1790577727`、完成 `1790577896`，`durationMs=168248`。後者是任務 turn duration，不能用兩個取整秒的差代替，也不能稱情境總耗時、有效工作或等待。完整讀取回應沒有下一頁；JSON 保存完整 final Markdown（Python `len` 為 4009 字元）。wait 預覽有截斷且回報 `originalChars=3553`，不使用該預覽取代完整 final，也不把兩種計數混為一談。

## 新任務自行查得的結果

新任務讀取 ai-product-plan skill，產品資料透過正式 `get_project`、`get_graph_context`、`list_repositories`、三次 `get_work_context`、`get_ticket_context` 及兩份 Project/Ticket resources 查詢。單一 turn 有 13 個 MCP tool markers；其中含 discovery 操作與兩次失敗，不是 13 次成功產品查詢。markers 保存 arguments、status、duration，**沒有新任務的原始 MCP response payload**。本紀錄以新任務完整回報及主流程前後正式回應交叉比對，不宣稱取得它全部原始查詢內容。

新任務自行識別 M1 `01M3JY37R2X5SCFQY52DDYNN2Y` 下的清單 Spec `01M3JY3DHYFY20WX92JYBQJNPG`、說明 Spec `01M3JY3JVHS4VMMPRCJMW4SPWY`，以及 M2 `01M3K9230M6CAH3C9WWPXM5KFH` 下的篩選 Spec `01M3K932Y5QHE8WGSKQG4R0HC3`，各自對應以下 Ticket。正式 Project Brief 為 v3 `01M3KA12FFGP6P112NQ93N7WDT`，graph revision 為 `01M3KAEJYTHYBPHDWSHD0R3XDQ`。

| Ticket | 新任務判讀及前後查詢一致的狀態 | 下一步 |
| --- | --- | --- |
| 清單 `01M3JY4YK7TQWT4A4X03W2CF4Y` | r2 planned／current；已有實作 Result 待接受，planned 不等於尚未實作 | `review_result` |
| 說明 `01M3JY4YKBVSWSNGTFWWV5Y2DJ` | done／current；原交付可沿用，共用 Repository 不構成依賴 | `done` |
| 篩選 `01M3K93WX6A48WS4YZMPW88CMQ` | 歷史 done／stale；新排序 Spec 與舊條件不同，並被清單依賴阻擋 | `reconcile_sources` |

新任務回報 total=3、done=2、stale=1、blocked=1、awaiting_acceptance=1，並明確說明維度重疊。規劃節點已 current，不代表引用舊 Spec 的篩選 Ticket 也 current。它辨識清單新 Result 的 20 項測試等摘要只是正式記錄，本次沒有重新驗證程式或測試，也沒有把 Result pending 視為 Acceptance。

## 沿用 identities 與唯讀核對

| Ticket | Revision | Implementation Brief | Result |
| --- | --- | --- | --- |
| 清單 | `01M3KAJCA9NHJQC6SFV0EXG1NK` | `01M3KB12V4HT2WH5W4814544P2` | `01M3KBBTAVGSQ1EAT5YKGY7GWY`（pending） |
| 說明 | `01M3JY4YKBTV4V7YBZR77TXXKP` | `01M3JZTZR6S7RS3FB26P5ZHZX3` | `01M3K097JXX36TDET2SCJ2F738`（accepted） |
| 篩選 | `01M3K93WX6B1YF53VWM7V87HCQ` | `01M3K9CMW3NQTY07S5BK4D1HHB` | `01M3K9WBNDZXJ5Y7NFXZK8BQYN`（歷史 accepted） |

三個 Target 依序為 `01M3JZS32J1PG41ZYQPHYMP3S2`、`01M3JZS7NP4Z74DCXM0J1N73HV`、`01M3K9ASKPMV35V52PN3ENP6J5`，均保留。主流程的 before／after graph 及三份 work-context 的完整 decoded `data` 物件逐一相等，canonical hashes 也一致，包含交付指標、來源與依賴狀態，不只比較顯示標題。

新任務沒有要求使用者重述已可查得的規格，單一 turn 未見任何 mutation、重新提交或接受操作；其回報明確建議沿用清單 r2 計畫與 Result、保留說明 identities、對篩選建立必要 replacement。上述四組查詢範圍內未觀察到新 artifacts。這是本次唯讀接手的具體證據，並非全歷史 artifacts 或 Acceptance audit，完整歷史重複計數仍未知。

## Ticket 交付與 Milestone 退出

新任務指出 M1 要求清單與說明各有有效使用者 Acceptance；清單 r2 尚無 accepted Result，因此不能判為退出。M2 還要求篩選相關排序變更已修復，篩選仍 stale／blocked，舊 done 不足以滿足目前退出條件。它建議先沿用清單 Result 完成必要審閱與使用者決定，再修復篩選，最後逐條核對 Milestone。

| #104 準則 | 結果 | 證據及邊界 |
| --- | --- | --- |
| C1：獲授權的真實新對話 | pass | 精確 prompt、真正 projectless task、單一完成 turn；未附完整歷史或預期狀態 |
| C2：關係與交付診斷 | pass | 自行回報 M1／M2、三條 Spec／Ticket 關係與實際診斷，符合保存的檢查點 |
| C3：沿用而不重建 | pass | 精確 IDs 沿用，未要求重述正式規格；無 mutation markers，四組正式 data 相等 |
| C4：需要實作時的 baseline／授權 | not_triggered | 本任務保持唯讀，未開始實作，沒有執行 Repository baseline handoff；不能列為已實測通過 |
| C5：退出條件及操作成本 | pass_with_measurement_limits | 區分 Ticket／Milestone，保存 turn duration 及已知失敗；完整成本仍未量測 |

## 實際成本、失敗與查詢限制

新任務兩次以 `ai_product_graph` 作為 resource server 名稱的 discovery 失敗，隨後經未指定 server 的 discovery，使用正式 `ai-product-graph` 完成 resource 讀取。原始錯誤 payload 未保存，失敗 status 與 arguments 有 markers 可查。主流程另有一次 `read_thread` 參數錯誤：`maxOutputCharsPerItem=40000` 超過上限 20000，改為 20000 後讀得完整 final；原始錯誤在 `task-read.json`。這三筆是已知工具參數／探索修正，不是使用者人工糾正，也不是整段流程的完整失敗總數。

總耗時、有效工作、等待、重複確認、人工修正與全歷史重複 artifacts 在 [JSON](2026-09-28-workflow-fresh-handoff.json) 保持 null。已知 turn duration **168,248 ms** 單獨列出，不推算上述成本。逐次查詢的牆鐘時間未保存；正式資料的 `updated_at` 不是查詢時間。

本次新任務所用查詢與回傳未提供獨立 Acceptance record ID／精確接受時間，以及逐條 evidence payload 和測試起訖；這是本次取得資料的範圍，不宣稱整個 API 不支援。Result 更新時間不能冒充接受時間；摘要殘留「等待接受」文字時，以結構化 `accepted_result`／`review_status` 為準。MCP 實際載入版本仍未驗證，主專案 PR base 不是 runtime 來源證據。

## 證據保存與核對

13 份本機來源位於 `/tmp/apg-delivery-current/scenario-c/`，另有 bytes 相同的保留副本 `/Users/limingfeng/Project/ai-product-graph/tmp/validation/20260928-continuation/scenario-c/`；後者為忽略目錄，並非 PR 附帶的公開原始證據包。JSON 保存必要投影、完整新任務 final、tool markers、各原檔 bytes hash、decoded hash 及四組前後 data hashes。decoded hash 使用 Python `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))` 的 UTF-8 bytes，非 RFC 8785；原始新任務 MCP payload 未由 markers 提供，不能從公開投影還原。

本票僅新增兩份文件，核對 13 份原始及保留副本 hashes、四組 decoded data 相等、具體 identities、13 個 MCP markers 與完整 final，另通過 JSON 格式及差異檢查；未為文件變更重跑主專案完整測試。JSON bytes SHA-256：`80a497688613d84a300af19791afb029038742dd29e5f3b554372bce589d7bf1`。
