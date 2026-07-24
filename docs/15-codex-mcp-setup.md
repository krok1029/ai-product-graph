# Codex MCP Setup

## 目的

這份文件說明如何在 Codex 中使用 AI Product Graph 的本機 stdio MCP server。

目前狀態：

- Phase 1A 尚未完成 scaffold。
- 以下設定會在 MCP server 可 build 後使用。

## Build Server

安裝 dependencies：

```bash
pnpm install
```

Build：

```bash
pnpm build
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
```

第一版 MCP server 不需要 LLM API key，因為 LLM generation 由 Codex client agent 執行。

## First Tools To Verify

連上 MCP server 後，先驗證：

- `create_project`
- `list_projects`
- `get_project`
- `add_idea`
- `get_idea`

## Troubleshooting

如果 Codex 無法啟動 server：

- 確認 `pnpm build` 已成功。
- 確認 `dist/index.js` 存在。
- 確認 Node.js 版本至少是 20。
- 確認 SQLite database path 的資料夾可寫入。
- 如果使用 `pnpm dev`，確認 Codex 啟動環境能找到 `pnpm`。
