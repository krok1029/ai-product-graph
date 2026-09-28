# 情境 B：來源往返防護與最終修復

本紀錄對應 [#105](https://github.com/krok1029/ai-product-graph/issues/105)，在 [#104 的唯讀接手](2026-09-28-workflow-fresh-handoff.md) 完成後繼續。Run ID：`workflow-sorting-acceptance-20260928`。**目前已完成來源內容往返及兩個真實拒絕檢查，兩份 replacement 已獲使用者核准；清單新 Result 已保存待接受，篩選仍受依賴阻擋。本票尚未完成。**

## 內容恢復原文，不使舊 handoff 復活

只對清單 Spec `01M3JY3DHYFY20WX92JYBQJNPG` 進行來源驗證：從目前「未完成優先、各組新到舊」暫存回舊排序內容，再恢復測試前的完整新排序內容。此為來源版本防護驗證，不是變更產品程式或新增功能。

| 階段 | Graph Revision | 清單 Spec 內容版本 | server 時間 |
| --- | --- | --- | --- |
| 往返前 | `01M3KAEJYTHYBPHDWSHD0R3XDQ` | `01M3KADF6D4SX07MBAPXY3QT5H` | 本次 query 時間未保存 |
| 暫存舊內容 | `01M3KCJ6F3KESEDVD33SVT3CGN` | 同左 | `2026-09-28T06:52:14.178Z` |
| 恢復新內容 | `01M3KCJS69KYGP6GM7K1ZGMQC5` | 同左 | `2026-09-28T06:52:33.353Z` |

[JSON](2026-09-28-workflow-sorting-acceptance.json) 保存完整前／中／後內容及 hashes。比較 title、description、parent identity 和結構化 content，恢復後與測試前完全相同，中間舊內容不同；Spec identity 沒變，內容版本確實前進。清單與篩選仍列在 affected Tickets，不能因文字恢復而把之前的交付來源當成 current。

使用既有清單 r2 Brief `01M3KB12V4HT2WH5W4814544P2` 及實際產品 commit `df6017401f752ea191cf6c1b2264c64b07ce67b3` 呼叫 `start_implementation`，回傳 `STALE_HANDOFF`／`graph_node_changed`。錯誤指出 r2 `01M3KAJCA9NHJQC6SFV0EXG1NK` 的 source graph 仍是 `01M3KAEJYTHYBPHDWSHD0R3XDQ`，清單 Spec 最新內容版本已是 `01M3KCJS69KYGP6GM7K1ZGMQC5`。已恢復相同文字的 Spec 沒有使舊 handoff 復活。

## 真正待接受 Result 的拒絕

本次針對 #111 真實實作產生、且 #104 已讀取的 pending Result `01M3KBBTAVGSQ1EAT5YKGY7GWY` 發起新的 Acceptance 請求，idempotency key 為 `workflow-b-20260928-source-roundtrip-negative-acceptance-01`。回應同樣是 `STALE_HANDOFF`／`graph_node_changed`，不是針對已接受結果重試造成的 CONFLICT。

`bBeforeStaleAcceptance.json` 與 `bAfterStaleAcceptance.json` 的完整 decoded data 逐一相等，canonical hashes 一致；pending Result 仍為 active／draft，沒有轉成 accepted。這支持本次被拒絕操作沒有改變查詢範圍內的交付狀態；它不是重新列舉完整 Acceptance 歷史。兩個負向呼叫及兩個來源保存檔均含 request／response，錯誤 envelope 保留原樣。

來源往返後另查 graph，實際 summary 為 total=3、done=2、stale=2、blocked=1、awaiting_acceptance=1；清單也因本次來源版本前進而 stale。獨立說明的完整 work-context 與情境 C 接手後資料完全相同。產品於 **06:56:02.346567Z** 唯讀確認仍為 `df6017401f752ea191cf6c1b2264c64b07ce67b3`、工作目錄乾淨。這些是保存的當時狀態，不代表 replacement 核准後的最終狀態。

## 已核准的必要 replacement

| Ticket | 草稿 | base | 最新 source graph |
| --- | --- | --- | --- |
| 清單 `01M3JY4YK7TQWT4A4X03W2CF4Y` | r3 `01M3KCMHD2SGC50XFRV3A0WAPS` | 原 r2 | `01M3KCJS69KYGP6GM7K1ZGMQC5` |
| 篩選 `01M3K93WX6A48WS4YZMPW88CMQ` | r2 `01M3KCN5S62J4WEQ1K0MKC07G0` | 原 r1 | `01M3KCJS69KYGP6GM7K1ZGMQC5` |

清單 r3 於 **06:53:30.913Z** 建立，保持已核准的排序行為，修復來源往返後的新版本引用。篩選 r2 於 **06:53:51.782Z** 建立，更新三種篩選對新排序的要求，保留對清單的依賴。兩者保留原 Ticket／Repository Target 的 identity，不用重建整個功能消除 stale。

使用者已在一次回覆中明確同意兩份草稿及實作授權。清單 r3 於 **06:57:55.325Z**、篩選 r2 於 **06:58:00.392Z** 核准；兩份正式回應保存於 JSON。核准後篩選為 planned／current，但 `blocking_dependency_ids` 仍包含清單，`next_action=complete_dependencies`；不能忽略 blocker 直接開工。舊 Result 或 Acceptance 不會自動代表新版接受。

## 相同程式的證據適用性與清單待接受 Result

唯讀適用性報告逐條比對清單 r3 六項及篩選 r2 七項準則，核對相同 commit `df6017401f752ea191cf6c1b2264c64b07ce67b3` 及 12 個檔案指紋，沒有發現需要改碼的缺口。原 20 項測試、排序桌面紀錄與獨立 Spec／Standards review 可沿用；本次沒有重跑並冒充新測試。舊情境 A 的全部檢視排序不適用新版，僅沿用未變互動，分組排序由情境 B 的新版證據支持。

`repair-evidence-applicability.md` 是作者當時對草稿的歷史唯讀映射，內文的「核准待完成」不代表後續正式核准仍未發生。報告指出三個按鈕逐一鍵盤啟動、未完成檢視新增尚未有直接紀錄，主流程已於 **06:56:57.466Z–06:57:27.587Z** 補實際桌面觀察：三種按鈕分別聚焦並 Enter 啟動，未完成檢視新增置頂，已完成檢視不顯示新未完成項目，回全部及重整後資料與順序保留。此補充未以 Tab 完整遍歷、未另讀 DOM identity、未注入儲存錯誤；identity 及錯誤邊界沿用原排序觀察與規則測試。

新清單 Brief `01M3KCYBZ93KX7C9BGYPEF7QB7` 於 **06:59:12.690Z** 核准，引用清單 r3 及真實相同產品 baseline，`start_implementation` 回傳 current。新 Result `01M3KD0E6ZT46X79XDDHKSCTB2` 於 **07:00:00.862Z** 保存，active／draft／reviewable、非 stale，六項均 satisfied、沒有未完成項目。它重用三筆適用的原 evidence，另加入桌面補充與適用性映射兩筆 evidence，完整 ID 關聯保存於 JSON。這是新 Revision 自己的 Result，歷史 Acceptance 未移轉。

主流程已展示清單結果並詢問使用者接受，此快照尚待答覆。篩選在清單接受前仍 blocked，尚未 start，也未提交篩選新版 Result。清單新 Result 不能視為已接受，篩選來源 current 也不代表依賴已完成。

## 尚待完成與證據範圍

待補：清單使用者 Acceptance、解除依賴後篩選的有效 handoff／Result／使用者 Acceptance、最終查詢、獨立說明及歷史 identities 保留比較。父 Spec／Milestone 是否達退出條件需另外逐條核對，不由本票文件自動推定。

目前 21 份原始資料在 `/tmp/apg-delivery-current/scenario-b-final/`（20 JSON、一份適用性報告）；JSON 保存各檔 bytes hashes，以及 JSON 解碼後 response envelope 或 document hashes。後者及內容比較使用 Python `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))` UTF-8 bytes，非 RFC 8785。總耗時、有效工作、等待、重複確認、人工修正、全歷史重複 artifacts 均未完整量測，保持 null。兩次來源保存及桌面補充只代表局部區間；MCP 實際載入來源仍未驗證，主專案 base 不是 runtime 證據。

本草稿核對原始來源、三階段內容、兩次錯誤、Acceptance 前後資料相等及正式核准／清單 Result 關聯，另通過 JSON 格式與差異檢查；未提交或開完成 PR。JSON bytes SHA-256：`12a7159fd2b6f3e2c2806b013ddafcbab89f1b03920873fc5f1e80bf60858aed`。
