# 使用者工作流

## Workflow 1：Idea 到 Product Brief

1. 使用者建立 project。
2. 使用者寫下模糊想法。
3. AI 找出缺少的上下文。
4. AI 提出釐清問題。
5. 使用者回答或略過問題。
6. AI 生成 Product Brief。
7. 使用者修改並確認 brief。

## Workflow 2：Product Brief 到知識圖譜

1. 使用者確認 Product Brief。
2. AI 萃取 graph nodes。
3. AI 萃取 graph relationships。
4. 系統回傳 graph draft。
5. 使用者可以透過 MCP client 要求合併、刪除或修改節點。
6. 使用者確認 graph version。

## Workflow 3：知識圖譜到 Tickets

1. 使用者選擇一個 feature area、epic 或 goal。
2. AI 根據相關 subgraph 提出 tickets。
3. 每張 ticket 包含 acceptance criteria 和 non-goals。
4. 使用者修改 ticket scope。
5. 使用者在本地建立 tickets，或之後匯出到外部工具。

## Workflow 4：Ticket 到實作上下文

1. 使用者選擇一張 ticket。
2. 系統收集 linked graph context。
3. 如果已知 repository context，系統收集相關程式碼參考。
4. AI 產生 implementation brief。
5. Coding agent 接收 brief。
6. Agent 建立 branch 或 PR。
7. 系統把 PR 連回 ticket 和 graph。

## Workflow 5：Feedback 到 Graph

1. 使用者記錄 feedback。
2. AI 把 feedback 連到相關 feature、ticket、release 或 goal。
3. 使用者確認 graph 更新。
4. 後續規劃使用更新後的上下文。
