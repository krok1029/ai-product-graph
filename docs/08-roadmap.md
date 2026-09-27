# Roadmap

## Phase 0：規劃

Status：規劃基線已建立；後續變更由 specs 與 GitHub Issues 追蹤。

Deliverables：

- 產品願景。
- MVP 需求。
- 知識圖譜模型。
- 初始架構。
- AI workflow 定義。
- 整合策略。

## Phase 1：本機 MCP Prototype

Status：本機主流程已落地；以完整 stdio demo 與各 ticket 的驗收維持可用程度。Phase 2 的 SQLite 持久化已提前包含於本階段。

Goal：

透過本機 MCP server 證明產品主流程。

Scope：

- 暴露 project 和 idea creation 的 MCP tools。
- 採用 DDD / ports & adapters，讓 core domain 不依賴外部介面。
- 生成 Product Brief。
- 生成 graph nodes 和 graph edges。
- 暴露 graph resources。
- 生成 local tickets。
- 生成 implementation brief。

Exit criteria：

- 可以從 MCP client 跑完一條 idea-to-ticket workflow，而且不依賴外部整合。

## Phase 2：真實儲存

Status：本機 SQLite、repository ports 與完整 schema 已在 Phase 1 落地；Postgres 仍延後。

Goal：

保存 canonical project、brief、graph 和 ticket data。

Scope：

- SQLite schema for local MCP usage。
- Repository layer，之後可以支援 Postgres。
- Graph mutation tools。
- Ticket mutation tools。
- AI output 的 draft / approved state。

Exit criteria：

- 使用者離開再回到 project 時，不會遺失 graph context。

## Phase 3：Plane Integration

已實作明確 mapping termination 與唯讀歷史查詢：使用者可停止未完成的同步義務，保留 Decision、原始 attempts／errors，並查詢 archived mapping 為何退出目前 health。此功能不撤回已送出的外部請求；mapped operations processor 仍須另行交付。

目前已交付首次匯出 preparation（Spec #45）：container 註冊、durable manual create request、intent／attempt 查詢及 stdio 重啟驗證。另已提供可注入 provider port 的首次 create 執行核心；已提供明確單次 Plane HTTP create／reconciliation CLI，stdio 啟動仍不自動連線 provider；active Plane Ticket mapping 已自動保存後續 approved content 與 done crossing 的 outbox，首次 create 成功也會補上執行期間的新 desired state；已提供 mapping 歷史與衍生 Ticket／mapping Sync Health；update/status execution／雙向同步仍未完成，因此本 Phase 尚未完成。

Goal：

支援 open-source PM tool 作為第一個外部 adapter。

Scope：

- 建立 Plane adapter port。
- 由使用者明確選擇 Ticket 與 Plane project 執行首次 export，不因 approval 或連線自動大量建立 work items。
- 首次 Plane export 只能使用 Ticket 的 current approved revision，並在 create intent 保存 source revision ID。
- Active mapping 建立後，自動同步後續 approved revisions 與適用狀態變更。
- 把 Plane 一般進度同步為內部 `planned`、`in_progress` 或 `blocked`，並保存來源與 audit event。
- 把 Plane closed／done 保存為 External Work Item 狀態，不得繞過 Result Acceptance 完成內部 Ticket。
- 內部 Ticket 完成後向 Plane 同步關閉 work item。
- 外部重新開啟已完成 Ticket 的 work item 時建立 Sync Conflict，且不得自動降低內部 Delivery Status。
- 保存 immutable External Work Item Snapshots；外部 specification content 與 approved Ticket Revision 不同時建立 Content Drift。
- 採用外部內容時建立 Ticket Revision Draft，不得直接改寫 approved specification。
- Outbound content sync 以最後 snapshot 的 version／ETag／updated timestamp 保護；外部已變或無法驗證時建立 Content Drift 並停止覆蓋。
- Adapter-managed 與 external-only fields 必須明確分離，labels、assignees、comments 等 external-only fields 不得覆蓋。
- 每個 External Work Item 使用獨立、可冪等重試的 Sync Attempt；partial failure 不得回滾 internal approval 或已成功項目。
- 使用 durable Sync Intent／outbox；approval transaction 不等待外部 API，服務重啟後可恢復 pending sync。
- 同一 mapping 依序處理 intents；只 coalesce 尚未開始的 content updates，create／close／reopen 等 lifecycle operations 必須保序。
- 新版 content 可取代 terminal-failed 舊 update 的 retry requirement；failed lifecycle operation 必須阻擋後續 intents。
- 永久失敗的 mapping 只能經使用者 Decision replace 或 terminate；archive 後才從 Sync Health 排除。
- 提供由 latest attempts 衍生的 `current | pending | failed` Sync Health。
- 在有用時連到 modules 或 cycles。

Exit criteria：

- Product graph 可以由使用者明確驅動 Plane 中的首次 work creation，且後續雙向狀態同步不會破壞內部 completion semantics；同步衝突可由使用者明確分類並追溯解決。

## Phase 4：GitHub Integration

Goal：

把 planning output 連到工程 workflow。

Scope：

- 由使用者明確選擇 repository-specific Implementation Target 執行首次 GitHub Issue export。
- 首次 GitHub export 必須驗證 target 屬於 current approved Ticket Revision，且 Repository 符合目標 GitHub container。
- Active GitHub mapping 建立後，自動同步後續 approved revision content 與適用狀態變更。
- Draft 只能 Markdown preview，不得建立 GitHub Issue 或 External Work Item mapping。
- 把 issue URL 與 external status 連到 Implementation Target。
- 保存 GitHub Issue content snapshots；規格差異不得直接改寫 approved Ticket Revision。
- 手動或透過 webhook 把 PR 連到 Implementation Target，並可追溯到 Ticket。
- 把 changed files 存成 graph nodes。

Exit criteria：

- 每個 Implementation Target 可以追溯到同一 Repository 的 issue、PR 和 changed files；Ticket 可聚合所有 targets 的工程追溯鏈。

## Phase 5：AI Implementation Loop

Status：本機 handoff、evidence、Result acceptance／revocation 已提前實作；真實 coding agent／PR 整合仍依外部整合階段推進。

Goal：

讓 AI agents 可以根據 ticket context 實作。

Scope：

- 生成 implementation brief。
- 把 graph context 餵給 coding agent。
- 捕捉 branch、PR、test result 和 summary。
- 實作後更新 graph。

Exit criteria：

- 一張小 ticket 可以從 graph 走到 PR，且保持 traceability。

## Phase 6：Optional UI

Goal：

在 MCP workflow 被證明有用後，再加入視覺化管理層。

Scope：

- Project dashboard。
- Product Brief editor。
- Graph visualization。
- Ticket board。
- Integration settings。

Exit criteria：

- UI 可以 inspect 和 manage 透過 MCP server 建立的資料。
