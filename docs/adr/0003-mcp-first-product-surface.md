# ADR 0003：MCP First Product Surface

## Status

Proposed

## Context

原本計畫包含 Web UI、graph visualization 和 ticket management。但第一版最重要的使用者其實是 AI agent，它需要的是結構化 project context 和可靠 actions。

如果先做 UI，會在 agent workflow 被證明前就被迫處理 API、state 和 interaction design。

## Decision

MVP 將是一個 MCP server。

Server 會暴露：

- Tools：project、idea、brief、graph、ticket 和 implementation actions。
- Resources：讀取 project context。
- Prompts：可重複使用的 product planning workflows。

Web UI 延後，等 MCP workflow 證明有價值後再做。

## Consequences

Benefits：

- 更快走到核心價值。
- 更適合 agent-based workflows。
- MVP 階段不需要處理過多 frontend / API coordination。
- 同一個 domain model 之後仍可支援 UI。

Trade-offs：

- Human review 初期會發生在 MCP client，而不是自訂 UI。
- Graph visualization 會延後。
- 沒有視覺介面時，部分使用者可能比較難理解產品。

## Revisit When

- 使用者需要視覺化探索 graph。
- 多個 projects 只透過 MCP 很難 inspect。
- 產品需要 onboarding、settings 或 integration management。
