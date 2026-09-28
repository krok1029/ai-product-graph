# ADR 0013：Product Brief 核准版本不可變

## Status

Accepted

## Context

ADR 0007 規定 AI 生成的 Product Brief 必須先成為 draft，經使用者 approve 後才能成為 canonical data；ADR 0008 規定 structured JSON 是 Product Brief 的 canonical source of truth。

但既有決策尚未定義什麼行為構成核准，也未說明已核准內容後續如何修改。如果未辨識同意的版本，就把一般聊天、後續操作或 agent 判斷當成核准，系統無法可靠判定哪一版產品意圖曾被使用者確認。如果已核准版本可以原地修改，過去產生的 graph、tickets 與 implementation handoffs 也會失去可追溯的依據。

## Options Considered

### A：允許隱含核准與原地修改

優點：

- 操作步驟最少。
- 使用者可直接修正目前內容。

缺點：

- 無法可靠區分討論、草稿與正式產品意圖。
- 已產生的 graph、tickets 與 handoffs 可能在事後失去原始依據。
- 稽核紀錄無法重建特定時間點的 approved Product Brief。

### B：明確核准，核准後原地修改

優點：

- 核准事件清楚。
- 資料模型比完整版本化簡單。

缺點：

- 核准後的修改仍會破壞歷史可追溯性。
- 難以證明某個衍生產物是根據哪一份內容建立。

### C：明確核准，核准版本不可變

優點：

- 每次核准都有清楚的使用者意圖與版本邊界。
- graph、tickets 與 handoffs 可以追溯到特定 Product Brief 版本。
- 歷史狀態可以可靠重建。

缺點：

- 修改已核准內容時必須建立新 draft。
- schema、tools 與 resources 必須支援版本生命週期。

## Decision

採用選項 C：MVP 每個 Project 具有一個穩定 Product Brief aggregate identity；內容存放在不可變 Product Brief Versions。Product Brief aggregate 本身不具有 Review Status，只具有 Lifecycle Status，並保存目前 approved version pointer。

Product Brief Version 只能根據使用者對特定 draft version 的明確核准，成為 approved version；使用者可在對話中核准，由 client 代為執行 approval tool。

每個 draft Product Brief Version 必須記錄建立時的 `base_approved_version_id`。Approval 時若該 base 不再等於 Product Brief 的 current approved version，必須回傳 conflict，不得取代較新的 approved decision。

使用者對已展示、可辨識版本的對話同意構成 approval 授權，例如「可以」「同意，就這版」。Client 直接呼叫既有 approval tool 保存核准者、時間與版本，成功後才回報核准完成；不要求特殊口令或第二次正式確認。單純表示理解、指涉不清的肯定、產生後續內容或 agent 自行判斷不構成 approval。

2026-09-27 修訂：依使用者要求，取代先前全面排除聊天肯定的規則。明確對話同意也可涵蓋已展示、範圍清楚的多個 drafts；client 逐一保存各版本的 approval，並分別回報成功或失敗，不宣稱跨 tools 的原子核准。對話授權不延伸到之後生成或修改的版本，也不取消版本衝突檢查。此互動規則同樣適用 Graph Draft Batch、Ticket Revision、Implementation Brief 與 Result Acceptance；waiver 仍須明確指定 criterion 與理由。

Approved Product Brief 是不可變快照。任何內容變更都必須建立新的 draft，經再次核准後才成為新的 approved 版本。舊的 approved 版本必須保留，供既有 graph、tickets 與 implementation handoffs 追溯。

## Rationale

- 產品的核心價值是可信且可追溯的 project context。
- 對話中的明確同意與版本綁定，兼顧一次確認的操作體驗及可追溯的 approval。
- 不可變版本讓衍生資料能穩定指向當時實際核准的產品意圖。
- 新 draft 流程與 ADR 0007 的 draft-first 原則一致。

## Trade-offs

- 接受修改流程多一個建立與核准新版本的步驟。
- 接受資料模型需要保留多個 Product Brief 版本。
- 接受讀取流程需要區分目前核准版本、歷史核准版本與進行中的 draft。

## Consequences

- Product Brief 資料必須具有穩定版本識別，並記錄 `approved_at` 與 `approved_by`。
- Product Brief aggregate 必須具有穩定 identity 與 `current_approved_version_id`。
- Product Brief Version 必須具有 immutable `base_approved_version_id`，approval 必須執行 optimistic concurrency check。
- 修改 approved Product Brief 的操作必須被拒絕，改由建立新 draft 的流程處理。
- Graph、tickets 與 implementation handoffs 應記錄其來源 Product Brief 版本。
- MCP tools 與 resources 必須清楚區分 draft、目前 approved 版本與歷史 approved 版本。
