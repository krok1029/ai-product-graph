# AI 工作流

## 生成責任邊界

第一版 MCP server 不直接呼叫 LLM。

MCP server 負責：

- 提供 prompt templates。
- 提供 project、brief、graph、ticket 等 structured context。
- 儲存 agent 回傳的 draft，並在使用者 approve 後轉成 canonical data。
- 驗證資料結構和關係品質。

MCP client 的 agent 負責：

- 讀取 prompts 和 resources。
- 執行實際 LLM generation。
- 將生成結果送回 MCP tools 建立 draft。

這個設計讓第一版不需要處理 API key、model selection、token cost 和 provider-specific errors。

## AI Workflow 1：釐清 Idea

Input：

- Raw idea。
- Optional user notes。
- Optional target market。

Output：

- Clarification questions。
- Assumptions。
- Suggested product framing。

Guardrails：

- 先問問題，再規劃實作。
- 區分 facts 和 assumptions。
- 不要自行捏造 technical constraints，除非標記成 assumptions。

## AI Workflow 2：生成 Product Brief

Input：

- Raw idea。
- Clarification answers。
- Assumptions。

Output：

- Product Goal。
- Target Users。
- Pain Points。
- Core Workflows。
- MVP Scope。
- Non-Goals。
- Success Metrics。
- Risks。
- Open Questions。

Guardrails：

- MVP 範圍要窄。
- Success criteria 盡可能可衡量。
- 保留 open questions，不要把不確定性藏起來。

## AI Workflow 3：萃取知識圖譜

Input：

- Approved Product Brief。

Output：

- Draft graph nodes。
- Draft graph edges。
- 每個 relationship 的 confidence score。

Guardrails：

- 避免 duplicate nodes。
- 使用明確 relationship types。
- Generated nodes 和 edges 先建立為 draft，approve 後才成為 canonical graph。

## AI Workflow 4：生成 Tickets

Input：

- Selected graph node 或 subgraph。
- Product Brief。
- Existing tickets。

Output：

- Ticket title。
- User story。
- Scope。
- Acceptance criteria。
- Non-goals。
- Related graph nodes。
- Implementation hints。

Guardrails：

- Ticket 必須小到足以一次 focused implementation pass 完成。
- Ticket 必須連到產品上下文。
- Ticket 必須包含 acceptance criteria。
- Generated tickets 先建立為 draft，approve 後才可進入實作或外部匯出。

## AI Workflow 5：Implementation Handoff

Input：

- Ticket。
- Related graph nodes。
- Repository metadata。
- Relevant files，如果已知。

Output：

- Implementation brief。
- Suggested files to inspect。
- Test strategy。
- Risks。
- PR summary draft。

Guardrails：

- Agent 編輯前必須先產生 plan。
- Agent 應該在可行時跑測試。
- PR 必須連回 ticket 和 graph nodes。
