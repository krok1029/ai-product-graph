# Skills 和 Tools

目前交付的本機流程 skills、安裝方式與 tools 分工以 [Skill 主導的本機工作流](./22-skill-led-workflows.md) 為準。GitHub 工作由 agent 使用 `gh` 完成，再依既有 MCP 契約保存證據；不要求 GitHub 專用 adapter 或額外 GitHub skills。以下其他項目保留早期工具選型評估，不代表目前已安裝或待辦。


## 目前評估

在寫規劃文件或開始簡單 prototype 前，不需要額外安裝 skills。

目前可用 skills 已經足夠支撐早期工作：

- `architecture`：產品與系統架構規劃。
- `openai-docs`：需要官方 OpenAI / Codex / API 文件時使用。
- `gh`：依工作授權操作 GitHub repository、Issue 與 PR；本 repository 的追蹤規則見 [issue tracker](agents/issue-tracker.md)。
- `next-best-practices`、`vercel-react-best-practices`、`ui-ux-pro-max`：之後如果要做 UI 再用。

## TypeScript 7 / tsgo

第一版 server runtime 仍然是 Node.js + TypeScript，但 toolchain 可以優先試用 TypeScript 7 / `tsgo`。

注意：

- TypeScript 7 是 Go-based native toolchain，目標是大幅提升 typechecking 和 language service performance。
- 若 MCP SDK、SQLite driver、test runner、build tooling 或 programmatic API 依賴尚未完全相容，應保留 TypeScript 6 fallback。
- 第一階段不要讓 TypeScript 7 試用阻塞 MCP server MVP。

## 之後值得考慮的 Skills

這些不急，但等 MVP 方向清楚後可能有用。

### Database Design Skill

如果有這類 skill，會很適合這個專案，因為產品高度依賴乾淨的 graph-like data model、migrations 和未來查詢模式。

適合使用時機：

- 設計第一版 SQLite schema。
- 設計 Postgres migration path。
- 加入 pgvector。
- 決定是否要移到 Neo4j、Memgraph 或 ArangoDB。

### API Design Skill

如果有這類 skill，會適合用在 MCP tools 和未來 API contracts。

適合使用時機：

- 設計 MCP tool input / output schema。
- 設計 public 或 internal API contracts。
- 版本化 graph mutation endpoints。
- 加入 webhook ingestion。

### Playwright / E2E Testing Skill

等 frontend prototype 出現後才需要。MCP-first MVP 暫時不需要。

適合使用時機：

- 測試 idea-to-graph workflow。
- 測試 graph interactions。
- 測試 ticket generation 和 export flows。

## Plugin 建議

目前不需要立即安裝任何 plugin。

未來可能有用的 plugins：

- Figma：如果產品設計參考或 mockups 放在 Figma。
- Slack：之後要把團隊討論匯入，轉成 graph-linked decisions 或 feedback。
- Atlassian Rovo：只有在要整合 Jira 或 Confluence 時才有用。
- Google Calendar 或 Outlook Calendar：MVP 不相關。
- Box、SharePoint、Teams、Outlook Email：除非客戶資料源需要，否則 MVP 不相關。

## 建議

不要現在就安裝更多 skills 或 plugins。先完成 MCP server 設計，等有明確 implementation task 時再補。
