# 整合策略

## 整合策略

MCP server 應該擁有 product context 和 graph data；外部系統則負責它們擅長的專門工作流。

第一個 integration target 不是 PM 工具，而是透過 MCP 連接 AI agent。

核心架構採用 DDD / ports & adapters。MCP、Plane、GitHub、未來 UI 或其他外部介面都應該透過 adapter 連到 application layer，不直接污染 domain model。

## MCP Clients

初始 use cases：

- 讓 AI agent 建立 projects 和 ideas。
- 讓 AI agent 生成 Product Briefs。
- 讓 AI agent 查詢 graph context。
- 讓 AI agent 生成 tickets。
- 讓 AI agent 建立 implementation briefs。

為什麼先做 MCP：

- 避免在 workflow 被證明前先做 UI。
- 給 agents 結構化、可 tool-call 的產品上下文。
- 讓知識圖譜可以被不同 AI clients 使用。
- 讓產品更貼近 ticket-to-code workflow。

## GitHub

初始 use cases：

- 匯出 tickets 到 GitHub Issues。
- 把 PR 連到 tickets。
- 讀取 PR metadata。
- 把 changed files 連到 graph nodes。

為什麼 GitHub 值得整合：

- Coding agents 和工程流程通常圍繞 repositories 和 PRs。
- Issues 容易建立和連結。
- 對早期 implementation workflow 已經足夠。

整合順序：

- MVP 不做 GitHub。
- Plane adapter 完成後，再評估 GitHub Issues / PR adapter。

## Plane

初始 use cases：

- 匯出 product tickets 到 Plane work items。
- 把 work item status 同步回 graph。
- 對已經需要 PM 功能的團隊，讓 Plane 作為專案管理 UI。

為什麼 Plane：

- Open-source project management product。
- 有現代 issue、module、cycle、page model。
- API 和 webhook integration surface 友善。
- 符合第一階段「開源 PM 工具」方向。

## Coding Agents

初始 use cases：

- 產生 implementation brief。
- 把選定 ticket handoff 給 Codex 或其他 coding agent。
- 接收 PR URL 和 test result summary。

MVP approach：

- 先從 markdown handoff documents 開始。
- MCP server 不內建執行 coding agent。
- 之後再加更深的自動化與 PR 回寫。

## Future Integrations

- GitLab
- Linear
- Notion
- Slack
- Figma
- Sentry
- CI systems

## Integration Priority

1. MCP clients。
2. Coding agent handoff。
3. Plane work items。
4. GitHub Issues 和 PRs。
5. Notion 或 Docs import。
6. Slack 或非同步團隊回饋。
