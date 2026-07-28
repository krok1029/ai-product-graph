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

目前這個 repository 包含規劃文件與 Phase 1A 的 source layout；TypeScript scaffold 與功能實作尚未開始。

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

先閱讀 `docs/16-operation-manual.md`；不需要從頭逐篇閱讀所有 `docs/` 文件。第一個實作版本已決定採用：

```text
本機 MCP server + Node.js + TypeScript + SQLite
```

Hosted MCP server、Postgres 和 UI 都延後，等本機 MCP workflow 被證明有用後再處理。
