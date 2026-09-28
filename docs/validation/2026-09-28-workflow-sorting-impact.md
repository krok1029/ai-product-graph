# 情境 B：排序規格變更後的原始影響

本紀錄對應 [#103](https://github.com/krok1029/ai-product-graph/issues/103)，延續 [情境 A 的已接受篩選](2026-09-28-workflow-filter.md)。Run ID：`workflow-sorting-impact-20260928`。**最終檢查點為三張歷史 done、兩張來源 stale、零 blocked、零待接受 Result。排序尚未修復或重新接受。** 這是 replacement 前的歷史快照，不是後續接手任務應當使用的即時進度。

使用者明確同意 Product Brief v3 `01M3KA12FFGP6P112NQ93N7WDT` 及調整後拆票：全部檢視改成未完成優先、各狀態組內新到舊，三種篩選沿用順序；保留資料與獨立說明。Server 於 **2026-09-28T06:13:40.985Z** 核准此版本。使用者另授權檢查點準備後建立不附完整聊天歷史的新 Codex 任務，只做唯讀接手，不自行接受產品。此處只記錄授權，尚未執行該接手。

## 真正改變內容，而非只重新確認

Project：`01M3JXSN8AEP7243K15BFMV4EB`。以下節點 identities 均保留；[證據 JSON](2026-09-28-workflow-sorting-impact.json) 保存前後內容雜湊及父來源版本。

| 節點 | 原內容版本 | 新內容版本 | 結果 |
| --- | --- | --- | --- |
| M1 | `01M3JY37R234AMMBHC1H4T2FKA` | `01M3KAD1ECNXBAMJ25N2V0W90J` | 清單範圍改為未完成優先 |
| 清單 Spec | `01M3JY3DHY9YTTVFR8S29Y7S8K` | `01M3KADF6D4SX07MBAPXY3QT5H` | 排序內容確實改變 |
| M2 | `01M3K9230MHJK7GW3P0TT1QMFV` | `01M3KAEBVJVVF23BBE2S7M96FW` | 篩選沿用新排序 |
| 篩選 Spec | `01M3K932Y50ZPDAT76R7SHYRPW` | `01M3KAEJYTHYBPHDWSHD0R3XDQ` | 排序內容確實改變 |
| 獨立說明 Spec | `01M3JY3JVH3D2EPE6ZNAM7H071` | 相同 | 同內容重新確認 M1 新來源 |

保存順序為 M1、說明 Spec、清單 Spec、M2、篩選 Spec，server 事件時間介於 **06:14:28.044Z–06:15:18.746Z**。獨立說明的 title、description、parent identity 與結構化 content 均相同；只更新來源父版本，符合 [ADR 0041](../adr/0041-scope-freshness-to-planning-content.md)。清單及篩選不能採同內容重新確認，因為其排序要求真正改變。

## 實際查詢狀態

| 觀察點 | Graph Revision | done | stale | blocked | awaiting acceptance |
| --- | --- | ---: | ---: | ---: | ---: |
| 篩選已接受的起點 | `01M3K932Y50ZPDAT76R7SHYRPW` | 3 | 0 | 0 | 0 |
| v3 核准後，尚未重新比對 | `01M3KABKFVMXJBWEGPD2QFR8ZR` | 3 | 3 | 0 | 0 |
| 規劃內容保存後 | `01M3KAEJYTHYBPHDWSHD0R3XDQ` | 3 | 2 | 0 | 0 |

v3 核准後，三張 Ticket 先因 `planning_source_unreconciled` 過期。規劃保存完成時，所有 planning nodes 已重新比對，但清單與篩選的 Ticket Revision 仍引用舊 Spec 內容，因此兩張 Ticket 的 `source_problem.reason` 為 `graph_node_changed`、`next_action` 為 `reconcile_sources`。規劃節點 current 不等於舊 Ticket 已適用新規格。

- 清單 Ticket：`01M3JY4YK7TQWT4A4X03W2CF4Y`，Revision `01M3JY4YK8HSMSNNS7HAXJ21A7`，done／stale。
- 篩選 Ticket：`01M3K93WX6A48WS4YZMPW88CMQ`，Revision `01M3K93WX6B1YF53VWM7V87HCQ`，done／stale。
- 說明 Ticket：`01M3JY4YKBVSWSNGTFWWV5Y2DJ`，Revision `01M3JY4YKBTV4V7YBZR77TXXKP`，done／current，下一步仍為 done。

篩選的 `dependency_ticket_ids` 明確包含清單 Ticket，但三張 Ticket 的 `blocking_dependency_ids` 都是空陣列。這份 graph 回應的 edges 只包含 `belongs_to`；依賴證據來自 delivery 欄位，不另捏造 graph edge。此刻清單的歷史 delivery status 仍是 done，不能把篩選的直接 stale 說成「已觀察到依賴 blocked」。replacement 後真正的阻擋狀態由後續票保存。

三張 Ticket 的 Revision、Target、approved Brief 及 accepted Result IDs 均與起點一致，所有 `pending_result_id` 均為 null。原有 Acceptance 沒有被本次流程撤銷；舊接受記錄只代表當時規格的交付，不能證明新版排序完成。Acceptance IDs 沿用情境 A：清單 `01M3K8JDVSHXTB7G39EMDZD97E`、說明 `01M3K8JJM0HS7NDJ2MTN0YPQMD`、篩選 `01M3K9Z3073PHD3G27JJJ5GJG5`。本次 graph／work-context 回應不回傳完整 Acceptance 歷史，保留判讀依據是相同的 accepted Result 指標及先前接受回應，不宣稱重新查得完整歷史。

獨立說明的額外 `get_work_context` 仍為 done／current，Brief `01M3JZTZR6S7RS3FB26P5ZHZX3`、Result `01M3K097JXX36TDET2SCJ2F738`，Result 保持 approved／active，`updated_at` 為原接受時間 **05:42:32.319Z**。本次沒有為無關說明建立 replacement 或再次接受。

## 舊 handoff 的真實拒絕與尚未執行的檢查

兩次 `start_implementation` 使用既有 Brief 及實際本機 commit `583e3019aeaf770d7b2e3ddcd6adbe0b7a8cddc9`，均回傳 `STALE_HANDOFF`，原因 `graph_node_changed`：

| Brief | 來源 Spec | 回應指出的最新內容版本 |
| --- | --- | --- |
| `01M3JZTV0R0RYXD1ZF6CAVRVB3` | `01M3JY3DHYFY20WX92JYBQJNPG` | `01M3KADF6D4SX07MBAPXY3QT5H` |
| `01M3K9CMW3NQTY07S5BK4D1HHB` | `01M3K932Y5QHE8WGSKQG4R0HC3` | `01M3KAEJYTHYBPHDWSHD0R3XDQ` |

錯誤原始回應只有 `content` 內的 JSON 文字及 `isError: true`，沒有 `structuredContent`；證據解析保留完整錯誤 envelope。請求參數由對話工具呼叫取得，暫存檔只保存回應，不偽稱為完整請求日誌。本紀錄編寫時唯讀核對產品 Git HEAD 仍是上述 commit、工作目錄乾淨；這是篩選版程式，尚未包含排序修復。

**沒有對已接受 Result 嘗試新的 Acceptance。** 已接受結果的 CONFLICT 不能證明 stale Acceptance 防護；依使用者同意的排程，此檢查移至 #104 接手後的 #105，以真正 pending Result 驗證。後續順序為 [#111](https://github.com/krok1029/ai-product-graph/issues/111) 建立必要 replacement、實作排序並留下待接受結果與實際依賴狀態 → [#104](https://github.com/krok1029/ai-product-graph/issues/104) 新任務唯讀接手 → [#105](https://github.com/krok1029/ai-product-graph/issues/105) 驗收與其餘修復。三者均非本檢查點已完成的成果。

## 成本與核對範圍

可定位的決策為 v3／調整拆票核准及新任務接手授權；沒有完整使用者訊息或查詢時間。server 核准到最後規劃保存的 **06:13:40.985Z–06:15:18.746Z** 只是已知事件區間，不能代表總耗時、有效工作或等待。總耗時、工作、等待、重複確認、人工修正與重複 artifacts 均未完整量測，JSON 使用 null，不填零，也不宣稱成本降低。

本機原始 12 份回應位於 `/tmp/apg-delivery-current/scenario-b/`。公開 JSON 保存必要投影、各檔 bytes SHA-256、解碼後 response envelope SHA-256；後者及內容雜湊使用 Python `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))` 的 UTF-8 bytes，非 RFC 8785 hash。內容比較只包含 title、description、parent identity 及結構化 content。投影不能還原完整回應，暫存檔需保留供 review。MCP 實際載入版本仍未驗證，沿用情境 A 的 runtime 限制；主專案 PR base 不是 runtime 來源證據。

公開 JSON bytes SHA-256：`ec216174c5c7e88abf70cd931cfc0e413fa45e300d00eef96816f75ea68507df`。本票只改兩份驗證文件，核對 12 份原始 hashes、三個狀態快照、五個規劃內容比較、三組交付 identities、兩次 handoff 錯誤及說明 context；未為文件變更重跑主專案完整測試。
