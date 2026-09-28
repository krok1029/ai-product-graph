---
name: ai-product-accept
description: 為 AI Product Graph 的實作結果整理可追溯證據、逐項驗收並記錄使用者接受或撤銷。適用於此 MCP 的交付驗收，不將一般測試執行自動視為產品驗收。
---

# 驗收實作

使用已連線的 AI Product Graph MCP，先讀取 tool schema。透過 `get_work_context` 取得精確 Ticket Revision、criteria 與 target；沿用實作時的 Implementation Brief ID，不把其他 target 或舊版本的接受結論搬過來。

先檢查 `pending_result`、`accepted_result` 與 `delivery`。已有符合目前工作且來源仍有效的候選結果時直接審查，避免重複提交。上游僅重新確認、Ticket Revision 與 Spec 內容版本未變時，沿用既有結果及有效 Acceptance，不要求重新接受；真正的來源變更仍須先修正 stale，不能用重播舊 Acceptance 當成新規格已驗收。

- 只使用實際執行的測試與可定位的產物。先讀 [evidence 格式](references/evidence.md) 中此次需要的類型；不用把所有格式載入。
- 使用 `submit_work_result` 一次送入 evidence 與候選 Result。每份新 evidence 使用本次呼叫內唯一的 `ref` 和穩定的 `idempotency_key`；criteria 用 `evidence_refs` 引用這些 ref，不必先取得 server evidence IDs。既有 evidence 可透過 `observed_evidence_ids` 加入，再以 `evidence_ids` 引用。
- 每項 criterion 分別判為 `satisfied` 或 `unsatisfied`，提供理由。`satisfied` 必須引用確實支持該條件的證據；不要把一份整體測試通過機械地套用到所有條件。
- 向使用者展示保存後的結果摘要、未滿足條件與未完成事項。對這份結果的明確對話同意即可呼叫 `accept_implementation_result`，不再要求額外正式核准。未滿足條件需使用者明確指定 waiver 及理由，不能自行豁免。
- 只有 server 回傳 Ticket `done` 才宣稱完成；多個 required targets 必須各有有效 Acceptance。Stale archived Result 只保存證據，不可接受。

不要求另存證據 JSON、驗收 Markdown 或每一步的中間文件；僅在使用者要匯出或需要引用真實檔案證據時產生。保留 Result ID 及 Acceptance ID 即可追溯。

`submit_work_result` 每次成功都建立新 Result，只有 evidence keys 冪等。結果不明時先查明是否已保存，不盲目重送；正常重新提交時明確判斷是否需 `supersedes_implementation_result_id`。Acceptance 則沿用同一 logical command 的 idempotency key 重試。

只有原 Acceptance 當時即無效且使用者要求撤銷，才使用 `revoke_result_acceptance`。後續新需求應另建 ticket/revision，不撤銷有效的歷史驗收。
