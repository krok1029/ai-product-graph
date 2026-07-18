# ADR 0006：第一版使用 SQLite，而不是 In-Memory Storage

## Status

Accepted

## Context

AI Product Graph 的核心價值是保存 project context、Product Brief、knowledge graph、tickets 和 implementation handoff。

第一版可以用 in-memory storage 快速 demo，也可以直接使用 SQLite。因為這個產品的重點是「保存與追溯上下文」，資料是否能持久保存會直接影響 MVP 的真實性。

## Options Considered

### A：In-Memory Storage

優點：

- 最快開始。
- 不需要 schema 和 migration。
- 適合一次性 demo。

缺點：

- Server 重啟後資料消失。
- 無法測試真實 project lifecycle。
- 很難驗證 graph traceability 的長期價值。
- 後續仍然要重做 persistence layer。

### B：SQLite

優點：

- 本機安裝簡單，不需要外部 database。
- 資料可以持久保存。
- 適合 single-user local MCP server。
- 可以早期驗證 project、graph、ticket 的真實 lifecycle。
- 之後可透過 repository layer 遷移到 Postgres。

缺點：

- 開工前需要設計 schema。
- 需要處理 migration 或 schema initialization。
- 比 in-memory 多一點開發成本。

## Decision

第一版使用 SQLite，不使用 in-memory storage 作為主要儲存。

## Rationale

- 產品核心是保存上下文，而不是一次性生成。
- SQLite 的額外成本可控，但能讓 MVP 更接近真實使用。
- 避免先做 in-memory，之後再重做 persistence 的浪費。

## Trade-offs

- 接受一開始需要設計 schema 和 repository layer。
- 暫時不做 Postgres、pgvector 或 hosted database。
- 若需要非常快速的單元測試，可以在 repository layer 底下提供 test-only in-memory adapter，但不是產品儲存策略。

## Consequences

- Phase 1 scaffold 應包含 SQLite schema initialization。
- Domain logic 應透過 repository interfaces 存取資料，保留未來 Postgres migration path。
- MCP tools 必須能讀寫本機 SQLite database。
