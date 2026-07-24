# ADR 0012：Phase 1A Tooling 與 Scaffold 邊界

## Status

Accepted

## Context

在開始實作 Phase 1A 前，需要決定 package manager、SQLite driver、TypeScript 7 使用方式、MCP SDK 接入策略、migration 範圍、DB path、測試框架、smoke test 和 Codex setup 文件。

這些決策會直接影響 scaffold，不適合邊寫邊猜。

## Decision

Phase 1A 採用以下決策：

- Package manager：`pnpm`。
- SQLite driver：`better-sqlite3`。
- TypeScript 7 / `tsgo`：Phase 1A 就安裝並試用。
- TypeScript fallback：保留 TypeScript 6 / `tsc`。
- MCP SDK：直接使用官方 `@modelcontextprotocol/sdk`。
- Migration 範圍：Phase 1A 建完整 schema。
- Repository 範圍：Phase 1A 只實作 projects / ideas / audit log。
- DB path：預設 `./data/ai-product-graph.sqlite`，可用 `AI_PRODUCT_GRAPH_DB_PATH` 覆蓋。
- Test framework：Vitest。
- Smoke test：`pnpm smoke`。
- Codex setup：現在補 `docs/15-codex-mcp-setup.md`。
- Dependency installation：由使用者手動執行 `pnpm install`，Codex 不自動安裝 dependencies。

## Rationale

- `pnpm` 提供穩定 lockfile 和快速安裝，適合 TypeScript 專案。
- `better-sqlite3` API 簡單，適合本機 MCP server。
- Phase 1A 就試用 `tsgo` 可以提早驗證 TypeScript 7 工具鏈，但 fallback 降低風險。
- 直接使用 MCP SDK 可以避免自製 protocol glue。
- 完整 schema 可避免後續 migration churn；repository implementation 仍保持小範圍。
- Vitest 對 TypeScript scaffold 輕量，適合作為第一版測試框架。
- Codex setup 文件提前補齊，能讓 MCP server 完成後直接接入。

## Trade-offs

- `better-sqlite3` 是 native dependency，安裝可能需要本機 build toolchain。
- `tsgo` 仍可能遇到相容性問題。
- 完整 schema 會讓第一個 migration 較大。
- 不自動安裝 dependencies 代表 scaffold 後需要使用者手動跑 `pnpm install`。

## Consequences

- Scaffold 時應新增 `pnpm-lock.yaml`。
- `package.json` scripts 應包含 `typecheck`、`typecheck:ts6`、`test`、`smoke`。
- Migration runner 第一版要能跑完整 schema。
- Smoke test 應走 application use cases，而不是只檢查 process startup。
