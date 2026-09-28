# 情境 A：新增篩選與沿用原交付

本紀錄對應 [#102](https://github.com/krok1029/ai-product-graph/issues/102)，延續 [#101 的歷史起點](2026-09-28-workflow-start.md)。Run ID：`workflow-filter-20260928`。**篩選功能已接受，末次查詢三張 Ticket 均為 done/current；初版兩份交付 identities 保留。** 本紀錄完成情境 A 的功能與追溯驗證；完整耗時、成本及 MCP runtime 來源仍有下述限制，不宣稱量測全部完成。

使用者已選擇「只做主專案 PR，清單維持本機」。本票 PR 交付工作流驗證紀錄；測試產品不建立 remote，其本機程式碼提交不能稱為產品 PR。初版兩份結果的明確接受與 v2 範圍核准是不同決策。

## 已接受的比較起點

Project：`01M3JXSN8AEP7243K15BFMV4EB`；Repository：`01M3JY1DNY41ABJ8WTZ1F9M0XN`。

| 項目 | 清單操作 | 獨立操作說明 |
| --- | --- | --- |
| Ticket | `01M3JY4YK7TQWT4A4X03W2CF4Y` | `01M3JY4YKBVSWSNGTFWWV5Y2DJ` |
| Spec 內容版本 | `01M3JY3DHY9YTTVFR8S29Y7S8K` | `01M3JY3JVH3D2EPE6ZNAM7H071` |
| Ticket Revision | `01M3JY4YK8HSMSNNS7HAXJ21A7` | `01M3JY4YKBTV4V7YBZR77TXXKP` |
| Implementation Brief | `01M3JZTV0R0RYXD1ZF6CAVRVB3` | `01M3JZTZR6S7RS3FB26P5ZHZX3` |
| accepted Result | `01M3K093HMFYYMCPV98D747EV2` | `01M3K097JXX36TDET2SCJ2F738` |
| Acceptance | `01M3K8JDVSHXTB7G39EMDZD97E` | `01M3K8JJM0HS7NDJ2MTN0YPQMD` |
| accepted_at（UTC） | `2026-09-28T05:42:27.446Z` | `2026-09-28T05:42:32.319Z` |

兩次 Acceptance 回應均為 Ticket `done`、Result `approved/active`，沒有 Waiver。後續 `get_work_context` 仍指向相同的 accepted Result，且 `updated_at` 仍為上述接受時間。此查詢不回傳 Acceptance ID；表中的 ID 來自不可變的接受回應及其 Result 關係，未另查完整歷史 Acceptance。

測試產品初版已保存為本機 commit `e6c72bca5d5215f96418345593a8b5a3f327bc8e`。從該 commit 逐一讀取 9 個檔案，manifest SHA-256 為 `793e99e81f17afeb1ce72274f0a1e575b270b5918f04a5b5b6096e77528a550a`，與 #101 當時尚未提交的 9 個檔案完全相同；這是程式碼基準提交，不是重新提交或接受 Result。

## 真實上游變更與重新確認

使用者同意版本 `01M3K8XHPM0PX5T79GHKCBBP04`，server 於 **05:49:47.475Z** 核准 Product Brief v2。內容新增「全部／未完成／已完成」、初始及重新整理回到全部、完成切換即時更新、無符合項目提示；保留既有排序、資料及獨立說明。draft 與 approved 的結構化 Brief 雜湊相同。

| 觀察點 | Graph Revision | done | stale | blocked | awaiting acceptance |
| --- | --- | ---: | ---: | ---: | ---: |
| 初版已接受 | `01M3JY3JVH3D2EPE6ZNAM7H071` | 2 | 0 | 0 | 0 |
| v2 核准後 | `01M3K8ZVJNDJ84H6P8BZ6VEQJF` | 2 | 2 | 0 | 0 |
| M1 同內容重新確認後 | `01M3K90GECWC8DRTJNY3ZGZX46` | 2 | 0 | 0 | 0 |
| 新篩選接受後 | `01M3K932Y50ZPDAT76R7SHYRPW` | 3 | 0 | 0 | 0 |

`done` 與 `stale` 是不同狀態軸：v2 核准後並未撤銷舊 Acceptance，兩張 Ticket 的來源均變成 `planning_source_unreconciled`，下一步為 `reconcile_sources`。當時 stale planning nodes 為 M1 及其兩份 Specs。

重新比對後，初版 M1 與兩份 Specs 仍完整適用。於 **05:50:08.844Z** 只保存 **M1 的相同內容**，確認它的新版父來源。M1 的內容版本 `01M3JY37R234AMMBHC1H4T2FKA` 保留，因此兩份 Specs 原來的父內容版本仍有效，**不需要再次保存 Specs**。兩張 Ticket 隨即恢復 `current`，下一步為 `done`。這符合 [ADR 0041](../adr/0041-scope-freshness-to-planning-content.md)，不把所有 stale descendants 都當作必須重建的 artifacts。

[證據 JSON](2026-09-28-workflow-filter.json) 比對三個規劃節點的 title、description、parent 與 content 的雜湊，並逐項保存前後 Spec 內容版本、Ticket Revision、Target、Brief、Result identities；相同內容重新確認沒有產生 replacement Ticket／Brief／Result，也沒有再次接受初版。新增篩選接受後已再次查詢 `filterFinalGraph`，兩組原交付 IDs 與三個規劃內容版本／雜湊仍相同。

## 新篩選實作、驗證與接受

已保存 M2 `01M3K9230M6CAH3C9WWPXM5KFH`、Spec `01M3K932Y5QHE8WGSKQG4R0HC3`，以及 Ticket `01M3K93WX6A48WS4YZMPW88CMQ` 的 Revision `01M3K93WX6B1YF53VWM7V87HCQ`；使用者同意後於 **05:55:45.907Z** 核准，draft／approved 的 specification 雜湊相同。新 Ticket 只依賴已完成的清單 Ticket；同一 Repository 的獨立說明不因此成為依賴。

新 Target 為 `01M3K9ASKPMV35V52PN3ENP6J5`，Implementation Brief 為 `01M3K9CMW3NQTY07S5BK4D1HHB`，使用已接受的本機 commit 作為乾淨基準，於 **05:56:57.674Z** 依既有同範圍實作授權核准並開始。

本機最終 commit 為 `583e3019aeaf770d7b2e3ddcd6adbe0b7a8cddc9`。已從 Git tree 重算 12 個檔案，逐項符合保存的 source manifest。初次 commit `c4a69d772fb83dab719859db8786935825fc0e67` 的獨立 Spec 與 Standards reviewers 均找到同一 P1：server 未提供新增的 filter module，導致頁面入口無法載入。補齊資源路由並加入實際 HTTP module graph 測試後，兩位 reviewer 在最終 commit 均無未解決 findings；這筆修正是實作 review 發現，不是使用者人工糾正。

- Node 20.19.0 實測 **17 passed／0 failed**，UTC **06:01:51.174255–06:01:51.352573**；涵蓋原有資料保護、篩選不寫入、狀態即時變動與真正 server 資源載入。
- 桌面實測 UTC **06:02:47.228–06:03:45.005**：三種篩選、兩種空狀態、鍵盤操作與焦點、在已完成檢視新增未完成項目、重新整理回全部及保留 identities／排序／完成狀態、獨立說明不改資料均通過。瀏覽器沒有破壞既有持久資料來注入錯誤；讀寫失敗由 Node 測試覆蓋。此紀錄是實際工具觀察整理，不是自動化 E2E 程式。

Result `01M3K9WBNDZXJ5Y7NFXZK8BQYN` 於 **06:05:21.452Z** 提交，7 項 verdicts 均 `satisfied`。使用者明確接受後，server 於 **06:06:50.883Z** 保存 Acceptance `01M3K9Z3073PHD3G27JJJ5GJG5`，7 項 outcomes 均 `satisfied`，沒有 Waiver。最終查詢三張 Ticket 全部 `done/current`、無 pending Result 或 blockers。review、測試及主專案 PR 沒有取代這次產品接受；B／C 仍不屬於本票驗證。

## 成本與證據限制

初版兩份 Result 接受與清單維持本機屬於 A 的前置決策；A 內已定位的必要決策為精確 v2 範圍核准、篩選 Ticket 核准及篩選 Result 接受。保存的 server event 時間只描述資料事件；使用者訊息、查詢及等待區間未完整計時，所以總耗時、有效工作、等待、重複確認、人工修正與重複 artifacts **均未量測，不填 0**，不宣稱已降低成本。Brief v2 draft 建立至篩選 Acceptance 的已知事件區間為 **05:48:31.828Z–06:06:50.883Z（1,099.055 秒）**；這未涵蓋最初情境請求、完整準備及末次查詢，不能當作總耗時。測試與桌面實測的各自起訖另保存在 JSON。

有一筆已知的 draft 建立失敗：`CONFLICT — Product Brief is linked to a different source Idea.` 原 Product Brief 綁定 Idea `01M3JXT488Z3CXGG5Y17RSYWD6`，呼叫帶入新提案 Idea `01M3K8WDR9P5410WSAKPRJT019`。改回原來源後成功保存 v2；失敗呼叫未建立 Brief artifact，新 Idea 留作提案來源。這段來自對話工具紀錄，未附失敗原始回應，不將其當成已核對的全部呼叫成本。

05:54:51 UTC 的觀察取得 23 個 tools 與 8 個 resource templates，與 core 能力表相符；但找到兩個指向本機 `dist/index.js` 的 Node processes，無法確認目前連線屬於哪個 PID，也無法由磁碟入口檔雜湊證明記憶體中的模組版本。未重啟 MCP、未重新採集三個 skills hashes；**process commit／實際載入版本仍未驗證**。主專案本 PR 的 base commit 不是 MCP runtime 證據，此限制使本紀錄不能作為版本效能比較。

原始回應位於本機 `/tmp/apg-delivery-current/scenario-a/`。公開 JSON 保存必要投影、各原始檔 bytes SHA-256 及 response `data` SHA-256；後者與節點雜湊使用 Python `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))` 的 UTF-8 bytes，不宣稱是 domain RFC 8785 hash。manifest 規則沿用 #101。公開投影無法還原完整回應，暫存檔若刪除便失去全文核對能力；應保留原始證據供 review。

公開 JSON bytes SHA-256：`be3cbad0736cfb5ed07f0f21cc81be74c93aae5d89e51ceb57507cf18e1fe31f`。本票核對 JSON、原始回應 hashes、兩次程式 Git trees、保留 identities 與文件連結；沒有為純紀錄變更重跑主專案完整測試。
