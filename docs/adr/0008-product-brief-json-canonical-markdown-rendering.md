# ADR 0008：Product Brief 使用 Structured JSON 作為 Canonical

## Status

Accepted

## Context

Product Brief 是 AI Product Graph 的核心中間產物。後續 graph extraction、ticket generation、implementation brief 都會依賴它。

Product Brief 同時需要：

- 對 agent 和程式可解析。
- 對使用者可讀。
- 可穩定轉換成 graph nodes 和 tickets。
- 可做 schema validation。

候選格式是 Markdown、structured JSON，或兩者並存。

## Options Considered

### A：Markdown 作為 Canonical

優點：

- 人類容易閱讀和編輯。
- 適合 handoff 和文件輸出。
- Git diff 友善。

缺點：

- 程式較難精準查詢欄位。
- Graph extraction 需要額外 parsing。
- 不容易做 schema validation。
- 不同 agent 可能產生結構不一致的 Markdown。

### B：Structured JSON 作為 Canonical

優點：

- 適合 MCP tools、resources 和 schema validation。
- 容易轉成 graph nodes 和 tickets。
- 欄位穩定，agent 可以精準讀取。
- 適合儲存在 SQLite JSON 欄位或 normalized tables。

缺點：

- 人類直接閱讀體驗較差。
- 不適合作為最終 handoff 文件。

### C：Structured JSON 作為 Canonical，Markdown 作為 Rendering

優點：

- JSON 保持資料正確性和可解析性。
- Markdown 保持人類可讀和 handoff 友善。
- 未來 UI、MCP resources、外部 export 都可從同一份 JSON render。

缺點：

- 需要維護 rendering function。
- 如果允許手動編輯 Markdown，會有同步問題；第一版應避免把 Markdown 當可回寫來源。

## Decision

採用選項 C：Product Brief 的 canonical source of truth 是 structured JSON；Markdown 只作為輸出、rendering、handoff 和 human review 格式。

## Rationale

- Product Brief 是後續 graph 和 ticket generation 的資料來源，因此需要穩定 schema。
- MCP server 的核心是提供 agent 可讀 context，structured JSON 比 Markdown 更適合。
- 使用者仍需要可讀格式，所以 Markdown rendering 必須存在，但不應成為 canonical。

## Trade-offs

- 接受需要撰寫 JSON-to-Markdown rendering。
- 暫時不支援 Markdown 直接回寫 canonical data。
- 如果未來需要 Markdown editing，必須新增 parser 或明確的 edit workflow。

## Consequences

- `product_briefs` table 應儲存 structured JSON payload。
- MCP resources 可以同時提供 JSON 和 Markdown representation。
- Graph extraction 應讀取 structured JSON，而不是 parsing Markdown。
- Prompt output schema 必須要求 structured JSON。
