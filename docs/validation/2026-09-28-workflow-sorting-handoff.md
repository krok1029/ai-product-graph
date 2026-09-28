# 情境 B：排序 replacement 與接手前檢查點

本紀錄對應 [#111](https://github.com/krok1029/ai-product-graph/issues/111)，延續 [#103 的原始排序影響](2026-09-28-workflow-sorting-impact.md)。Run ID：`workflow-sorting-handoff-20260928`。**排序實作與審查已完成，新 Result 已保存並保持待接受。最終快照為 3 張 Ticket：2 張歷史 done、1 張 stale、1 張 blocked、1 份待接受 Result；清單新版尚未由使用者接受。**

Product Brief v3 `01M3KA12FFGP6P112NQ93N7WDT` 的範圍保持不變：未完成優先，各狀態組內依新增先後由新到舊，三種篩選沿用此順序；保留原資料、身份及獨立操作說明。產品位於 `/Users/limingfeng/Project/workflow-checklist`，依使用者選擇維持本機、沒有 remote；本主專案 PR 僅保存驗證紀錄。

## 使用最新來源修復過期 Ticket

清單 Ticket `01M3JY4YK7TQWT4A4X03W2CF4Y` 原 r1 為 done／stale。雖然舊 Revision 的來源已過期，仍能依最新規劃建立合法 replacement r2，並保留原 Ticket 與 Target identity：

| 項目 | 原版本或來源 | 新版本或結果 |
| --- | --- | --- |
| Ticket Revision | `01M3JY4YK8HSMSNNS7HAXJ21A7` | `01M3KAJCA9NHJQC6SFV0EXG1NK` |
| r2 base | — | 原 r1 |
| r2 source graph | — | `01M3KAEJYTHYBPHDWSHD0R3XDQ` |
| 清單 Spec | `01M3JY3DHYFY20WX92JYBQJNPG` | identity 相同，採新版排序內容 |
| Implementation Target | `01M3JZS32J1PG41ZYQPHYMP3S2` | identity 相同 |
| Implementation Brief | `01M3JZTV0R0RYXD1ZF6CAVRVB3` | 舊 Brief 自動 archived |
| 舊 Result | `01M3K093HMFYYMCPV98D747EV2` | 自動 archived |

r2 於 **2026-09-28T06:17:23.016Z** 建立；使用者明確回覆「同意 r2 並授權實作」，server 於 **06:24:24.855Z** 核准。r2 不只是重新確認舊文字：它要求未完成優先、同毫秒或時鐘倒退仍保持新增次序、跨組切換不改身份與原建立次序、持久資料格式不變，以及篩選與焦點回歸。

核准回應明確列出舊 Brief 及 Result 的 archived IDs，沒有 archived Target。舊 Acceptance `01M3K8JDVSHXTB7G39EMDZD97E` 的身份沿用情境 A 證據；本次未撤銷、複製或重建 Acceptance，也未重新查得完整 Acceptance 歷史。自動封存舊 Result 與撤銷歷史接受是不同動作。新 r2 的 accepted Result 指標為 null，舊接受不能充當新版排序的驗收。

## replacement 後才出現真正依賴阻擋

| 觀察點 | done | stale | blocked | awaiting acceptance |
| --- | ---: | ---: | ---: | ---: |
| #103 規劃保存後 | 3 | 2 | 0 | 0 |
| r2 核准後、新 Brief 建立前 | 2 | 1 | 1 | 0 |

第二列來自 `bAfterReplacementGraph.json`，graph revision 仍為 `01M3KAEJYTHYBPHDWSHD0R3XDQ`。這些數字是不同維度，不能相加成 Ticket 總數。

- 清單已為 planned／current，下一步 implement；accepted／pending Result 均為 null。
- 篩選 `01M3K93WX6A48WS4YZMPW88CMQ` 仍保留歷史 done，但 source stale（`graph_node_changed`），且 `blocking_dependency_ids` 現在確實包含清單 Ticket。它同時有直接來源過期及依賴阻擋；下一步仍優先 `reconcile_sources`。
- 獨立說明 `01M3JY4YKBVSWSNGTFWWV5Y2DJ` 仍 done／current，下一步 done，原 Revision、Brief 與 accepted Result 指標保持不變。

因此本次可以報告真正的 blocked；#103 的 blocked=0 歷史紀錄仍然正確。篩選的新來源修復與接受保留到接手之後，不能因這次排序程式整合而把篩選也標為新版完成。

## 新的實作 handoff

新 Brief `01M3KB12V4HT2WH5W4814544P2` 於 **06:25:24.835Z** 建立、**06:25:31.498Z** 核准，明確 supersedes 舊 Brief。它引用 r2、Product Brief v3，以及 Repository Context Snapshot `01M3KB12V4NDY3ZKMY0C8JT5GN`。snapshot 記錄實際篩選版 baseline `583e3019aeaf770d7b2e3ddcd6adbe0b7a8cddc9`、無未提交修改；本次 `start_implementation` 回傳 `freshness: current`。

計畫從原資料陣列派生未完成／已完成分組，避免按完成狀態直接重排保存資料而丟失原新增次序。獨立說明保持原文。原始檔只保存工具回應，baseline 請求值依操作對話記錄，不偽稱原始檔含完整請求日誌。

## 真實實作、審查與待接受結果

本機產品 commit 為 `df6017401f752ea191cf6c1b2264c64b07ce67b3`，相對上述 baseline 實作顯示用穩定分組，保留保存陣列的新增次序。測試紀錄核對該 commit 與乾淨工作目錄，公開 JSON 收錄 12 個 tracked files 的 SHA-256；編寫本紀錄時也逐一比對實際檔案。

- Node 20 規則及實際伺服器測試於 **06:27:35.271466Z–06:27:35.594182Z** 執行，20 項通過、零失敗，涵蓋混合狀態、同毫秒／時鐘倒退、跨組切換、新增、持久化、篩選與讀寫保護。差異檢查通過。
- `sorting_spec_review` 與 `sorting_standards_review` 分別審查上述確切 base／head，各自重跑 20 項測試，均無未解決問題。此處保存的是兩位獨立 agent 的回報，不把 review 當成使用者接受。
- 真實桌面瀏覽器觀察於 **06:28:04.425Z–06:29:48.247Z** 完成：原 3 筆保留，完成／取消移到正確組別，新項目進未完成組最前，三種篩選沿用順序，移出篩選後焦點回對應按鈕，重整回全部且身份、文字、狀態及排序一致。
- 獨立說明 markup 與 baseline 的 bytes 相同（SHA-256 `927db8c71ca082d180da7f6c5924ce7e654774d1b00b7f0894776298e80e028e`）；桌面展開與 Enter 收合也未改變清單資料。瀏覽器未注入損壞或拒絕儲存，這些錯誤邊界由規則測試驗證；桌面記錄是實際工具觀察整理，並非自動化 E2E 程式。

新 Result `01M3KBBTAVGSQ1EAT5YKGY7GWY` 於 **2026-09-28T06:31:16.570Z** 建立，引用 r2、新 Brief 及原 Target。它為 active／draft、`submission_disposition: reviewable`，`stale_at_submission: false`，六項準則均 satisfied，沒有未完成項目。三組 evidence IDs 與六項 verdict 對應保存於 JSON。這是排序實作產生的新 Result，並非把舊接受複製為新交付；本次沒有建立 Acceptance。

## 提交後保存的接手檢查點

`bHandoffCheckpointGraph.json` 的 graph revision 仍為 `01M3KAEJYTHYBPHDWSHD0R3XDQ`，實際 summary 為 total=3、done=2、stale=1、blocked=1、awaiting_acceptance=1。done、來源 stale、依賴 blocked 及待接受是不同維度，不互斥。

| Ticket | 保存的實際狀態 | 下一步 |
| --- | --- | --- |
| 清單 | planned／current；新 Brief 指標與上述 Result 的 pending 指標有效，accepted 指標為 null | `review_result` |
| 獨立說明 | done／current；原 Revision、Target、Brief、accepted Result 均保留 | `done` |
| 篩選 | 歷史 done／stale；原 Revision、Brief 及 accepted Result 保留，但被清單依賴阻擋 | `reconcile_sources` |

JSON 比較 replacement 後及 Result 提交後的三組 delivery identities：只有清單增加新的 approved Brief 與 pending Result；說明及篩選的既有交付指標不变。篩選仍需最新來源的必要 replacement，即使共用程式已通過排序整合測試，也不能視為篩選的新規格已接受。

此檢查點供已獲授權的 [#104](https://github.com/krok1029/ai-product-graph/issues/104) 新任務唯讀接手，該任務尚未開始；它不附完整聊天歷史、不自行接受產品。接受與剩餘修復由 [#105](https://github.com/krok1029/ai-product-graph/issues/105) 處理。此處未對已接受 Result 嘗試新 Acceptance，也沒有 stale Acceptance 拒絕證據。後續應查詢即時狀態，不能把此歷史快照當成永遠的目前狀態。

## 成本與證據限制

可定位的決策是精確 r2 草稿核准及實作授權，使用者訊息時間未保存。已知 server 事件 **06:17:23.016Z–06:31:16.570Z** 只涵蓋 replacement 草稿建立到新 Result 建立，不代表總耗時或等待時間。總耗時、有效工作、等待、重複確認、人工修正及重複 artifacts 均未完整量測，[JSON](2026-09-28-workflow-sorting-handoff.json) 保持 null，不填零、不宣稱成本降低。

13 份原始回應及本機測試、瀏覽器、review 紀錄位於 `/tmp/apg-delivery-current/scenario-b-repair/`。公開 JSON 保存必要投影、各檔 bytes SHA-256，以及解碼後 response envelope SHA-256；後者使用 Python `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))` 的 UTF-8 bytes，非 RFC 8785。投影不能還原完整回應，原始 A／B／repair 證據也已複製到主專案忽略目錄 `/Users/limingfeng/Project/ai-product-graph/tmp/validation/20260928-continuation` 供本機保留與 review，未宣稱為隨 PR 提交的公開 artifact bundle。本機紀錄使用 decoded document hash，MCP 回應使用 decoded envelope hash。MCP 實際載入版本仍未驗證，沿用情境 A 的 runtime 限制；主專案 PR base 並非 runtime 來源證據。

已記錄的測試呼叫區間為 0.322716 秒，桌面觀察區間為 103.822 秒；兩者只是有邊界的局部觀察，不能推算完整有效工作或等待。

本票僅改兩份驗證文件，核對原始 hashes、12 個程式指紋、三組交付 identities、六項 verdict 及最終 summary；未為文件變更重跑主專案完整測試。JSON bytes SHA-256：`d44cf544cece4d88daaff955e30721a7332cb112b25bec0f6d5af506610fa089`。
