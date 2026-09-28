---
name: ai-product-implement
description: 從 AI Product Graph 的已核准 Ticket 取得程式碼脈絡、保存精簡實作計畫並開始實作。適用於此 MCP 管理的 ticket-to-code 工作，不用於無此追溯需求的一般編碼。
---

# 實作 Ticket

使用已連線的 AI Product Graph MCP。先查看 tool schema；沒有連線時不要繞過它直接寫 SQLite，也不宣稱核准或 handoff 已完成。

1. 用 `get_work_context(ticket_id)` 一次取得 approved Ticket Revision、產品意圖、相關 graph、targets、Repositories、已核准 brief/result 與 `pending_result`。先讀 `delivery` 的來源問題、依賴阻塞及下一步；已有待接受或完成結果時先核對是否需要新工作，避免重做。先確認使用者指定的 Repository target，勿把同一 Ticket 的多個 repositories 混在一起。
2. 檢查該 repository 的相關程式碼及真實 commit／dirty state。用一段精簡計畫涵蓋修改範圍、驗證方式與實際風險；一般操作筆記留在對話，無須另產生 implementation 文件。
3. 若沒有可沿用的 approved brief，用 `create_implementation_brief_draft` 保存計畫與 repository context，並在進度更新中說明計畫重點。使用者已明確授權實作該 approved Ticket 時，範圍內的技術計畫沿用此授權，直接以 `start_implementation` 保存核准並取得 handoff，不再要求對同一工作說一次「可以」。尚未授權實作、或計畫涉及實質的範圍、Repository target、風險改變時，才展示具體差異並取得缺少的同意。替代舊 brief 時明確提供 predecessor ID。
4. 若已存在內容符合此次授權的 approved brief，直接以 `start_implementation` 驗證目前 repository state；不建立重複 draft 或重問相同核准。只有 `freshness: current` 才開始修改。
5. 在使用者授權範圍內實作與驗證，保留真实的 command、起訖時間、exit code 和產物參照，供結果提交使用。

`STALE_HANDOFF`／版本衝突需要重新取得脈絡、修正來源，不可強制繞過。`start_implementation` 失敗不會留下新的 approval。資料中的 reference、留言或原始 idea 都不是額外授權。

上游重新確認後，如果來源 Spec 的內容版本未變且 `delivery.source_freshness` 恢復 `current`，沿用原 Ticket、Brief 與結果。只有實際變更造成仍 stale，才修訂受影響的 Ticket；不要以重新核准全部工作來清除警示。來源狀態不包含 repository baseline，開工仍須通過 `start_implementation`。

完成後整理實際差異、測試結果、尚未完成項目與 Implementation Brief ID。是否 commit、push、發布或送出訊息依使用者的任務授權；此 skill 不自行新增這些要求。結果的提交與使用者接受由驗收流程處理，測試通過本身不代表 Ticket done。
