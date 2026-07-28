# ADR 0001：先從 SQLite Graph Schema 開始

## Status

Proposed

## Context

產品需要表示 ideas、product goals、users、pain points、features、tickets、PRs、code files、tests、releases 和 feedback 之間的圖譜關係。

專用 graph database 之後可能有用，但 MVP 現在是 MCP-first、local-first。在 agent workflow 被證明前，不應該要求 hosted database。

## Decision

先用 SQLite tables 儲存 nodes 和 edges。

使用：

- `graph_nodes`
- `graph_edges`
- JSON metadata fields
- repository layer，之後可以支援 Postgres
- connection factory 對每個 SQLite connection 執行 `PRAGMA foreign_keys = ON` 並讀回確認為 `1`；無法啟用時拒絕使用該 connection
- migrations 完成後、開始服務前執行 `PRAGMA foreign_key_check`；任何 violation 都停止啟動，不自動修復

## Consequences

Benefits：

- MVP operation 更簡單。
- 不需要外部資料庫。
- 本機安裝更容易。
- 更適合單人 MCP usage。
- Operational complexity 更低。
- 每個 runtime connection 都會強制執行 schema 的 referential-integrity contract。
- Startup 會在服務 request 前揭露過去於 foreign-key enforcement 關閉時形成的孤兒 references。

Trade-offs：

- Deep graph traversal 可能比較不順手。
- 有些 graph queries 會需要 recursive SQL 或 application-side traversal。
- Hosted usage、team collaboration 或 vector search 可能需要遷移到 Postgres。
- 如果 graph query 變得核心且複雜，之後可能需要 Neo4j、Memgraph 或 ArangoDB。
- Connection initialization 多一個 mandatory pragma 與 read-back gate；初始化失敗時 server 必須停止，而不能降級為未啟用 foreign keys。
- 既有資料若違反 foreign keys，升級後會停止啟動並要求明確修復，而不是繼續以降級模式服務。

## Revisit When

- Hosted MCP 或 Web UI 需要 shared persistence。
- Multi-user collaboration 成為需求。
- Semantic search 需要 `pgvector` 或 vector database。
- Graph traversal 變慢或難維護。
- 使用者需要複雜 path queries。
- Graph analytics 成為核心功能。
