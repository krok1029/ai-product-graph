# MCP-First 架構

## 決策

AI Product Graph 的第一個實作版本應該是 MCP server，而不是 Web app。

MCP server 就是第一個產品介面。它讓 AI agent 可以建立和查詢產品上下文、生成圖譜結構、產生 tickets，並準備 implementation handoff。

## 為什麼 MCP First

- 核心使用者是 AI agent，不是操作 dashboard 的人。
- 如果先做 UI，會在 agent workflow 被證明前就被迫設計 API、state 和 interaction。
- MCP 很自然地對應到這個產品：
  - Tools 負責 actions。
  - Resources 負責 project context。
  - Prompts 負責可重複使用的 workflows。
- UI 之後仍然可以建立在同一個 domain model 上。

## MCP Tools

MVP 採用「少量粗粒度 workflow tools + 必要 read tools」。細粒度 mutation tools 可以保留，但不應在第一版把 tool surface 做得過大。

### Project Tools

```text
create_project
list_projects
get_project
update_project
```

### Idea Tools

```text
add_idea
list_ideas
get_idea
clarify_idea
```

### Product Brief Tools

```text
generate_product_brief
get_product_brief
update_product_brief
approve_product_brief
```

### Graph Tools

```text
generate_graph
list_graph_nodes
list_graph_edges
get_graph_context
get_node_trace
create_graph_node
create_graph_edge
update_graph_node
```

### Ticket Tools

```text
generate_tickets
list_tickets
get_ticket
update_ticket
get_ticket_context
```

### Implementation Tools

```text
create_implementation_brief
link_pull_request
record_test_result
record_release
record_feedback
```

## MCP Resources

建議 URI patterns：

```text
product-graph://projects
product-graph://projects/{projectId}
product-graph://projects/{projectId}/brief
product-graph://projects/{projectId}/graph
product-graph://projects/{projectId}/tickets
product-graph://tickets/{ticketId}
product-graph://tickets/{ticketId}/context
product-graph://nodes/{nodeId}
product-graph://nodes/{nodeId}/trace
```

第一版 MCP transport 使用 stdio local server。HTTP-based MCP server 延後到 hosted / multi-user 需求明確後再做。

## MCP Prompts

建議 prompts：

```text
product-brief
extract-graph
generate-tickets
implementation-brief
review-ticket-quality
trace-feature-context
```

## 本機 MVP 儲存

第一版直接使用 SQLite：

```text
projects
ideas
product_briefs
graph_nodes
graph_edges
tickets
implementation_briefs
external_links
audit_log
```

原因：

- 本機安裝容易。
- 不需要 hosted database。
- 適合單人 MCP 使用情境。
- 之後可以透過 repository layer 遷移到 Postgres。

## Product Brief Format

Product Brief 的 canonical data 使用 structured JSON。

Markdown 只作為輸出、rendering、handoff 或 human review 格式，不作為 canonical source of truth。

第一版 Product Brief JSON 應至少包含：

```text
product_goal
target_users
pain_points
core_workflows
mvp_scope
non_goals
success_metrics
risks
open_questions
```

## LLM Generation Responsibility

第一版 MCP server 不直接呼叫 LLM。

Server 提供：

- MCP prompts。
- MCP resources。
- Structured context。
- 儲存與驗證 tools。

Client agent 負責實際 generation，然後把結果透過 tools 回寫成 draft。使用者 approve 後，draft 才能轉成 canonical data。

## Repository Context Boundary

第一版 MCP server 不直接掃描 local repository。

Implementation brief 可以接受使用者或 client agent 提供的 repo summary、file list、module notes 或其他 code context。這讓 server 保持安全和簡單，同時仍能生成比純產品層更有用的 handoff。

## Review Surface

Human review 第一版放在兩個地方：

- MCP client 對話確認。
- Markdown draft export，用於閱讀、diff 和 handoff。

不做 UI review。

## ID Strategy

Graph nodes、tickets 和其他主要 entities 使用 ULID 作為穩定 ID，並另外保留 display slug 供人類閱讀、搜尋和外部匯出使用。

## Semantic Search

第一版預留 embedding / semantic search 欄位或 extension point，但不實作 embeddings。先把 graph 結構、traceability 和 MCP workflow 做穩。

## Primary MCP Client

第一版以 Codex 為 primary target MCP client，因為它最貼近 ticket-to-code workflow。同時保持標準 MCP 相容，不寫死 Codex-only 行為。

## 第一個 Demo

第一個 demo 應該透過 MCP client 跑：

```text
使用者提供模糊想法
  -> agent calls add_idea
  -> agent calls clarify_idea
  -> 使用者回答問題
  -> agent calls generate_product_brief
  -> agent calls generate_graph
  -> agent calls generate_tickets
  -> agent calls create_implementation_brief
```

這個 demo 不需要 Web UI。

## 安全與品質規則

- Mutating tools 應該回傳結構化 summary，說明改了什麼。
- 第一版應避免 destructive tools。
- AI-generated Product Briefs、graph nodes、graph edges 和 tickets 一律先建立為 draft。
- Draft 必須經使用者 approve 後才成為 canonical data。
- Graph edits 應寫入簡單 audit log，記錄 action、entity、before / after summary 和 actor。
- 每張 generated ticket 應該連到至少一個 product goal 或 pain point。
- Implementation briefs 應包含 acceptance criteria、non-goals 和 related graph context。
