# ADR 0005：第一版由 Client Agent 執行 LLM Generation

## Status

Accepted

## Context

AI Product Graph 需要生成 clarification questions、Product Brief、graph nodes、tickets 和 implementation brief。

這些能力可以由 MCP server 直接呼叫 LLM，也可以由 MCP client 的 agent 使用 server 提供的 prompts 和 resources 來完成。

第一版的目標是先證明 MCP workflow，而不是先處理 LLM provider、API key、成本控管和 model routing。

## Options Considered

### A：MCP server 直接呼叫 LLM

優點：

- Server 可以控制 prompt、model 和 output format。
- Tool result 較產品化。
- 不同 MCP clients 的行為較一致。

缺點：

- 需要處理 API key、model selection、token cost、rate limit 和 provider errors。
- 本機安裝設定更複雜。
- 會提早綁定 LLM provider 或 abstraction。

### B：MCP server 只提供 prompts / context，由 client agent 生成

優點：

- Server 不需要持有 LLM API key。
- 本機 MVP 更簡單。
- 可充分利用使用者目前 MCP client / agent 的能力。
- 更符合 MCP server 作為 context 和 tools provider 的角色。

缺點：

- 不同 MCP clients 的 generation 品質可能不同。
- Server 對最終 output 的控制較少。
- 需要更嚴格的 schema validation 和 draft review。

### C：Hybrid

優點：

- 可以先簡單，之後再加入 server-side generation。
- 保留長期產品化彈性。

缺點：

- 一開始就需要設計兩種 execution path，複雜度較高。

## Decision

第一版採用選項 B：MCP server 不直接呼叫 LLM，只提供 prompts、resources、structured context 和儲存 tools，由 MCP client 的 agent 執行 generation。

## Rationale

- 目前最重要的是證明 agent 能否透過 MCP 使用產品知識圖譜，而不是證明 server-side AI pipeline。
- 避免在 MVP 階段處理 API key、成本、model routing 和 provider-specific failures。
- 讓 MCP server 的責任更清楚：保存產品知識、提供上下文、驗證資料結構。

## Trade-offs

- 接受不同 client agent 輸出品質不一致。
- 接受第一版對 generation 過程的控制較少。
- 透過 draft review、schema validation、graph quality rules 降低風險。

## Consequences

- `generate_*` tools 第一版應偏向「建立 prompt/context 或儲存 agent 回傳結果」，而不是自己呼叫 LLM。
- MCP prompts 和 resources 會是核心產品介面。
- 後續若要加入 server-side LLM，可以新增 ADR，而不是改變第一版責任邊界。
