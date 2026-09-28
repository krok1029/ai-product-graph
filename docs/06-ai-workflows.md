# AI 工作流

預設由 `ai-product-plan`、`ai-product-implement`、`ai-product-accept` 三個 skills 編排以下工作；六個 MCP prompts 留在 full 相容模式。參見 [Skill 主導的本機工作流](./22-skill-led-workflows.md)。

## 生成責任邊界

第一版 MCP server 不直接呼叫 LLM。

MCP server 負責：

- 提供 full 相容模式的舊 prompt templates；core 的流程由三個 skills 編排。
- 提供 project、brief、graph、ticket 等 structured context。
- 保存與核准 Product Brief／Ticket drafts；自動套用已授權的 Milestone／Spec 規劃變更，保存版本與 audit。
- 驗證資料結構和關係品質。

MCP client 的 agent 負責：

- 依 skills 讀取 tools／resources context；舊 prompts 僅在 full 使用。
- 執行實際 LLM generation。
- 將生成結果送回 MCP tools，依內容種類建立 draft 或保存規劃節點。

這個設計讓第一版不需要處理 API key、model selection、token cost 和 provider-specific errors。

## 對話核准

Client 建立 draft 後展示內容與版本 identity。使用者針對該版本說「可以」「同意，就這版」即為明確核准，client 直接呼叫對應 approval tool，不再要求另一次正式確認。使用者不必輸入 tool 名稱或版本 ID；client 必須能從已展示的內容辨識確切版本。

「上面這三張都可以」可一次授權核准已展示的三個版本，client 逐一呼叫工具並回報各自結果。授權不涵蓋之後生成或修改的 drafts；指涉不清或僅表示理解時才釐清。Client 不得自行決定核准，工具成功前不得宣稱已核准。Server 仍保存 Local Actor、時間、版本與 audit，並執行既有 concurrency／freshness 檢查。

此規則涵蓋 Product Brief、Ticket Revision 與結果接受。使用者已明確授權實作 approved Ticket 時，同範圍 Implementation Brief 可沿用此授權，不另增加確認回合；實質範圍、target 或風險變更才補足同意。Result Acceptance 使用 `accept_implementation_result`；未滿足 criterion 的 waiver 仍需使用者明確指定項目並提供理由。唯讀 review／trace 本身不核准資料。

目前 core 規劃順序是 **Product Brief → Milestone → Spec → Ticket**。Milestone／Spec 保存即更新圖譜，不需 graph approval；下列涉及 Graph Draft approval 的舊流程僅供 full 舊專案相容。完整契約見 [階層規劃](23-planning-hierarchy.md)。

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

## AI Workflow 3：階段規劃與自動圖譜同步

Input：

- Current approved Product Brief。
- 現有規劃與目前 Graph Revision。
- 使用者已授權的範圍與截止條件。

Output：

- Milestones：成果、順序、範圍、退出條件與 non-goals。
- Specs：問題、方案、使用者故事、實作／測試決策與排除範圍。
- 自動更新的 graph nodes／relationships、版本與影響清單。

Guardrails：

- 先展示階段邊界，再依授權範圍展開；不為每層增加確認回合。
- 使用 stable identities 更新現有規劃，保存時檢查最新 base。
- 上游變更先重新比對，仍適用的相同內容保留 content revision；不重建既有交付來清除 stale。
- Full 未採用階層的舊專案才使用 extract-graph prompt 與手動 Graph Draft Batch approval。

## AI Workflow 4：生成 Tickets

Input：

- 有效的 source_spec_id 及完整 Spec → Milestone → Product Brief 來源鏈；full legacy 路徑沿用舊產品來源。
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
- 新階層 Ticket 必須來自 Spec，補上完整 ancestry 與依賴；原 legacy 路徑才使用 goal／pain point 規則。
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
- 交付摘要；此次範圍包含 PR 時再準備 PR summary。

Guardrails：

- Agent 編輯前必須先產生 plan。
- Agent 應該在可行時跑測試。
- 建立 PR 時必須連回 Ticket 與正確 Repository target；沒有 PR 的本機交付仍可用 evidence／Result 驗收。
- 同範圍計畫沿用明確實作授權，開工前仍通過 `start_implementation` 的來源與 baseline 驗證。
