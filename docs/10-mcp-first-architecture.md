# MCP-First 架構

## 目前決策

AI Product Graph 以本機 stdio MCP 提供結構化產品資料，client agent 透過三個 skills 完成規劃、實作與驗收。SQLite 保存正式資料，server 負責版本、關係、交易與來源驗證，不直接呼叫 LLM 或執行 coding agent。

目前流程為 Product Brief → Milestone → Spec → Ticket → Implementation Brief／handoff → Evidence／Result → Acceptance。詳細設計見 [系統架構](05-system-architecture.md)、[精簡工作流](22-skill-led-workflows.md) 與 [階層規劃](23-planning-hierarchy.md)。

## 介面分工

| 介面 | 責任 | 範圍 |
| --- | --- | --- |
| Skills | 對話、內容生成、程式碼檢查、來源重新比對、整理驗收 | 規劃／實作／驗收三個入口 |
| MCP tools | 驗證、保存、核准及查詢正式資料 | core 23 個；full 45 個 |
| MCP resources | 提供 Project、graph、Ticket 與 trace 等上下文 | 本機讀取入口 |
| MCP prompts | 相容原有 workflow templates | 六個，僅 full 提供 |
| Markdown export | 閱讀、分享或人工檢視 | 按需，非正式資料來源或必經步驟 |

Skills 不可直接改 SQLite 代替 MCP commands。工具名稱與欄位以 [MCP Tool Spec](12-mcp-tool-spec.md) 及其連結的新契約為準，不從早期候選名稱推測 API。

## 正式資料與變更

- Product Brief Version、Ticket Revision 等待審內容先建立 draft，對具體版本取得對話同意後保存 approval。
- Milestone／Spec 在已授權的規劃範圍內保存即同步圖譜，保留 Graph Revision 與 automation audit，不另作 graph approval。
- 來源重新確認與內容版本分開；Spec 內容未改且完整來源鏈有效時，原交付可沿用。真實變更、封存、歸屬與依賴問題仍受 freshness 檢查。
- 同範圍技術計畫可沿用對 approved Ticket 的實作授權；新結果仍須使用者接受。歷史有效 Acceptance 不因新增需求自動撤銷。
- `get_graph_context` 回傳 planning 與全專案 active Tickets 的 delivery 診斷；`get_work_context` 提供逐 Ticket、逐 target 的正式工作脈絡。

## 儲存與 Repository 邊界

SQLite 及 repository ports 已落地；schema 以 [SQLite Schema](13-sqlite-schema.md) 與 migrations 為準。主要 identities 使用 ULID，structured JSON 是正式內容；Markdown 是衍生輸出。

Server 不直接掃描 Repository。Client 檢查真實程式碼與 commit／dirty state，提供 Repository Context 並在 `start_implementation` 驗證 baseline；僅讀到產品來源 current 並不足以直接開工。

## 相容與選配

Full 保留未採用新階層的舊專案操作及外部工具，不會因此自動遷移 Project、啟動 processor 或關閉 active mapping 的 enrollment。階層化專案即使由 full 操作也必須遵守新來源規則。

Hosted MCP、Postgres、embeddings 及 UI 尚未排入交付。Primary client 是 Codex，資料與工具維持標準 MCP 邊界；其他 client 的 workflow 編排需另行驗證。先驗證本機持續開發的價值，後續依 [roadmap](08-roadmap.md) 處理真實缺口。
