# AI Product Graph

AI Product Graph 是一個 MCP-first 的產品概念，目標是把模糊的產品想法轉成結構化的產品知識、tickets，最後銜接到 AI agent 的實作流程。

這個產品第一版不應該從完整專案管理工具或重 UI 的 Web app 開始。第一版應該是一個 MCP server，直接把產品規劃、知識圖譜、ticket 生成等能力暴露給 AI agent 使用。

## 產品論點

大多數專案管理工具可以管理任務，但很容易遺失任務背後的理由：

- 為什麼要做這個功能？
- 這個功能解決哪個使用者痛點？
- 哪些 tickets 實作了它？
- 哪些 pull requests 改了相關程式碼？
- 哪些檔案和測試與它相關？
- 哪些回饋改變了產品方向？

AI Product Graph 透過專案知識圖譜，把這些關係明確保存下來。

## MCP-First 方向

第一個產品介面是 MCP server。

```text
AI agent
  -> MCP tools
  -> 產品圖譜核心領域
  -> 本機儲存
  -> 可選外部整合
```

UI 可以之後再做，作為圖譜視覺化和管理介面。它不應該阻擋第一個可用版本。

## 初始產品循環

```text
模糊想法
  -> AI 釐清
  -> Product Brief
  -> 知識圖譜
  -> Epics 和 tickets
  -> AI 實作計畫
  -> 程式碼修改和 PR
  -> 更新圖譜
```

## Repository 狀態

目前已實作本機 stdio MCP、SQLite 持久化，以及 Project／Repository／Idea → Product Brief → Graph → Ticket Revision → Implementation Brief／handoff → Observed Evidence／Implementation Result → Result Acceptance／Revocation 的主流程。另提供 6 個 client-side prompts、9 個 resources、node trace 與三種 artifact 的 Markdown 匯出。

Plane integration 目前完成首次匯出的本機 preparation：註冊穩定 container identity、明確提交 pinned export request、查詢 intent 與 attempt history。另有可注入 provider port 的首次 create 執行核心，支援 durable claims、reconciliation、原子 mapping／snapshot 保存，以及 active mapping 的 durable content/status enrollment；正式 stdio 不啟動 processor；Plane HTTP adapter 可由明確單次 CLI 執行 first create／reconciliation，Phase 3 的後續 update/status execution 與雙向同步尚未完成。

`pnpm test` 包含真實 stdio server、全新暫存資料庫、跨重啟 receipt replay 與 SQLite integrity 的端到端驗證；`pnpm smoke` 驗證 application 主路徑到 Result submission。TypeScript 7／6 typechecks 與 build 也是交付檢查。這些檢查涵蓋目前可驗證路徑；其他規格邊界由 GitHub Issues 持續追蹤。

日常操作與文件閱讀入口請先看 [`docs/16-operation-manual.md`](docs/16-operation-manual.md)。欄位級 MCP 契約與 storage 細節再分別查 `docs/12-mcp-tool-spec.md`、`docs/13-sqlite-schema.md`。

## 資料夾結構

```text
.
├── AGENTS.md
├── README.md
├── data/
│   └── .gitkeep
├── docs/
│   ├── 00-vision.md
│   ├── 01-product-requirements.md
│   ├── 02-user-workflows.md
│   ├── 03-information-architecture.md
│   ├── 04-knowledge-graph-model.md
│   ├── 05-system-architecture.md
│   ├── 06-ai-workflows.md
│   ├── 07-integrations.md
│   ├── 08-roadmap.md
│   ├── 09-skills-and-tools.md
│   ├── 10-mcp-first-architecture.md
│   ├── 11-implementation-plan.md
│   ├── 12-mcp-tool-spec.md
│   ├── 13-sqlite-schema.md
│   ├── 14-phase-1a-scaffold-spec.md
│   ├── 15-codex-mcp-setup.md
│   ├── 16-operation-manual.md
│   ├── adr/
│   ├── agents/
│   ├── prompts/
│   └── research/
└── src/
    ├── domain/
    ├── application/
    ├── adapters/
    │   └── mcp/
    └── infrastructure/
        ├── migrations/
        └── sqlite/
```

## 建議下一步

從 [GitHub Issues](https://github.com/krok1029/ai-product-graph/issues) 的 `ready-for-agent` 功能票繼續。每張票具備獨立驗收、commit 與 PR，通過獨立 spec／coding standards review 後 merge。Spec 彙總：

- [Local delivery acceptance loop](https://github.com/krok1029/ai-product-graph/issues/16)
- [MCP planning and provenance reading](https://github.com/krok1029/ai-product-graph/issues/18)
- [Human review Markdown exports](https://github.com/krok1029/ai-product-graph/issues/19)

第一個實作版本採用：

```text
本機 MCP server + Node.js + TypeScript + SQLite
```

Hosted MCP server、Postgres 和 UI 都延後，等本機 MCP workflow 被證明有用後再處理。

## Plane 首次匯出

已排入的 Plane create Sync Intent 可透過 `pnpm plane:export -- <sync-intent-id>` 明確執行。連線參數、重試限制及 built command 見 [操作手冊](docs/16-operation-manual.md#單次-plane-首次匯出-cli)。一般 stdio 啟動不會自動匯出；後續 update／close／reopen execution 與雙向同步仍待完成。

同步義務可透過 `list_mapping_sync_intents` 查閱完整歷史，並以 `get_mapping_sync_health`／`get_ticket_sync_health` 取得衍生 health。沒有 enrollment 的 `current` 會明確標記 `not_enrolled`；health 不修改 approval 或 completion，詳見操作手冊。
