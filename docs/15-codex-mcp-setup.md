# Codex MCP Setup

## 目的

這份文件說明如何在 Codex 中使用 AI Product Graph 的本機 stdio MCP server。

目前狀態：

- Phase 1A scaffold、完整 SQLite migrations、Project／Idea tools 與 Product Brief draft／approval workflow 已建立。
- Dependencies 已安裝；build、兩套 typecheck、Vitest 與 smoke test 已通過。

## Build Server

安裝 dependencies：

```bash
pnpm install
```

Build：

```bash
pnpm build
```

Typecheck：

```bash
pnpm typecheck
pnpm typecheck:ts6
```

至少一個 typecheck command 必須通過；`typecheck:ts6` 是相容性 fallback。

Tests：

```bash
pnpm test
```

本機開發：

```bash
pnpm dev
```

Smoke test：

```bash
pnpm smoke
```

## Database Path

預設 database path：

```text
./data/ai-product-graph.sqlite
```

可以用 env 覆蓋：

```bash
AI_PRODUCT_GRAPH_DB_PATH=/absolute/path/to/ai-product-graph.sqlite
```

## Codex MCP Server 設定

Codex 需要以 stdio 方式啟動 server。

建議 command：

```bash
node /Users/limingfeng/Project/ai-product-graph/dist/index.js
```

開發模式可使用：

```bash
pnpm --dir /Users/limingfeng/Project/ai-product-graph dev
```

正式使用建議先 build，再用 `node dist/index.js`，避免 MCP client 啟動時依賴 dev runtime。

## Environment

可選 env：

```text
AI_PRODUCT_GRAPH_DB_PATH=/Users/limingfeng/Project/ai-product-graph/data/ai-product-graph.sqlite
AI_PRODUCT_GRAPH_ACTOR_ID=00000000000000000000000001
AI_PRODUCT_GRAPH_ACTOR_NAME=Local User
```

第一版 MCP server 不需要 LLM API key，因為 LLM generation 由 Codex client agent 執行。

Approval actor 由 server environment 決定，不接受 MCP client 傳入。`AI_PRODUCT_GRAPH_ACTOR_ID` 應使用穩定 identity；更換 ID 代表不同的 Local Actor。

## First Tools To Verify

連上 MCP server 後，先驗證：

- `create_project`
- `list_projects`
- `get_project`
- `add_idea`
- `get_idea`
- `create_product_brief_draft`
- `approve_product_brief_version`

## Troubleshooting

如果 Codex 無法啟動 server：

- 確認 `pnpm build` 已成功。
- 確認 `dist/index.js` 存在。
- 確認 Node.js 版本至少是 20。
- 確認 SQLite database path 的資料夾可寫入。
- 如果使用 `pnpm dev`，確認 Codex 啟動環境能找到 `pnpm`。
- 如果出現 `Could not locate the bindings file`，執行 `pnpm rebuild better-sqlite3`。專案已在 `pnpm.onlyBuiltDependencies` 允許這個 native dependency 的 install script。
