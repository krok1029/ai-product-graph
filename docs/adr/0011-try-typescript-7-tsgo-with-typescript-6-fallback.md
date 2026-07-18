# ADR 0011：試用 TypeScript 7 / tsgo，保留 TypeScript 6 Fallback

## Status

Accepted

## Context

TypeScript 官方在 2026 年發布 TypeScript 7.0，這是將既有 TypeScript compiler 和 toolset port 到 Go 的 native implementation。官方描述 TypeScript 7 通常比 TypeScript 6 快約 10 倍，並提供 `tsgo` 作為新的 CLI。

這個專案第一版已決定使用 Node.js + TypeScript 開發 MCP server。因為 TypeScript 7 的 Go-based toolchain 很適合大型 TypeScript 專案的快速 typechecking，也符合我們想嘗試新技術的目標，因此第一版可以試用。

但 TypeScript 7 仍有工具相容性風險，尤其是 programmatic API、部分 editor / framework integrations、test runner 或 build tooling。

## Decision

第一版優先試用 TypeScript 7 / `tsgo` 作為 typechecking toolchain。

同時保留 TypeScript 6 fallback。MCP server 的實作不應依賴 TypeScript 7 尚未穩定的 programmatic API。

## Rationale

- `tsgo` 可以提供更快的 typechecking，適合快速迭代。
- 專案仍是 TypeScript source code，不需要改變 runtime 或 domain design。
- 保留 TypeScript 6 fallback 可以降低新 toolchain 對 MVP 的風險。

## Trade-offs

- `package.json` scripts 需要區分 primary 和 fallback typecheck。
- 若 dependency tooling 對 TypeScript 7 支援不足，可能需要暫時用 TypeScript 6。
- 第一版不應使用 TypeScript compiler API 作為核心功能。

## Consequences

- Scaffold 時可以加入 `typecheck` 和 `typecheck:ts6` scripts。
- `tsgo` 只作為 toolchain 試用，不影響 MCP protocol、DDD boundaries 或 SQLite schema。
- 如果 TypeScript 7 阻塞開發，立即回退 TypeScript 6，不需要新增架構決策。
