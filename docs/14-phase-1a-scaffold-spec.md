# Phase 1A Scaffold Spec

## 目的

Phase 1A 的目標是建立最小可跑的 TypeScript MCP server scaffold，並完成 SQLite migration skeleton 和第一批 projects / ideas use cases。

這份文件是實作邊界，不取代完整 Phase 1 plan。

## 已決定事項

- Package manager：`pnpm`。
- SQLite driver：`better-sqlite3`。
- TypeScript toolchain：Phase 1A 就安裝並試用 TypeScript 7 / `tsgo`。
- TypeScript fallback：保留 TypeScript 6 / `tsc` scripts。
- MCP SDK：直接使用官方 `@modelcontextprotocol/sdk`。
- Migration 範圍：Phase 1A 建立完整 schema。
- Repository 範圍：Phase 1A 只實作 projects / ideas / audit log。
- DB path：預設 `./data/ai-product-graph.sqlite`，可用 `AI_PRODUCT_GRAPH_DB_PATH` 覆蓋。
- Test framework：Vitest。
- Smoke test：`pnpm smoke`。
- Codex MCP setup doc：現在補。
- Dependency install：由使用者手動執行 `pnpm install`。

## Phase 1A 不做

- Product Brief tools。
- Graph tools。
- Ticket tools。
- Markdown export implementation。
- Plane adapter implementation。
- GitHub adapter。
- HTTP MCP transport。
- Server-side LLM calls。
- Direct local repository scanning。
- Embeddings。

## Package Scripts

建議 scripts：

```json
{
  "dev": "tsx src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "typecheck": "tsgo --noEmit",
  "typecheck:ts6": "tsc -p tsconfig.json --noEmit",
  "test": "vitest run",
  "smoke": "tsx src/smoke.ts"
}
```

若 `tsgo` 與 dependencies 相容性不足，`typecheck:ts6` 是 fallback。

## Dependencies

Runtime dependencies：

```text
@modelcontextprotocol/sdk
better-sqlite3
ulid
zod
```

Dev dependencies：

```text
@types/better-sqlite3
@types/node
@typescript/native-preview
tsx
typescript
vitest
```

## First MCP Tools

Phase 1A 只做：

- `create_project`
- `list_projects`
- `get_project`
- `add_idea`
- `get_idea`

## First MCP Resources

Phase 1A 只做：

- `product-graph://projects`
- `product-graph://projects/{projectId}`

## Smoke Test

`pnpm smoke` 應驗證：

1. Load config。
2. Open SQLite database。
3. Run migrations。
4. Create project。
5. Add idea。
6. List projects。
7. Get idea。
8. Confirm audit log has records。

Smoke test 可以直接走 application use cases，不一定要透過 MCP client。

## Definition Of Done

Phase 1A 完成條件：

- `pnpm install` 可安裝 dependencies。
- `pnpm build` 可通過。
- `pnpm typecheck` 或 `pnpm typecheck:ts6` 至少一個可通過。
- `pnpm test` 可通過。
- `pnpm smoke` 可通過。
- MCP stdio server 可啟動。
- SQLite database 和完整 schema 可初始化。
- 第一批 project / idea tools 可用。
