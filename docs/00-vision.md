# 願景

## 一句話定位

從模糊想法到上線功能，並且讓每個產品決策、ticket 和程式碼變更都能在知識圖譜中被追溯。

## 問題

產品想法通常一開始都很模糊。現有專案管理工具擅長追蹤任務，但不擅長保存任務背後的產品理由。

常見問題：

- 產品目標和 tickets 分離。
- Tickets 失去決策背景。
- 程式碼變更和使用者需求脫節。
- AI agent 不知道一個任務為什麼重要。
- 團隊很難從一個功能追溯到最初想法、release 和後續回饋。

## 解法

建立一個 MCP-first 的 AI 產品開發系統：

- 透過結構化 AI 對話釐清模糊想法。
- 把產品思考整理成 Product Brief。
- 從 brief、tickets、程式碼、PR 和回饋中萃取 Project Knowledge Graph。
- 生成可實作的 tickets。
- 給 coding agent 足夠的上下文，讓它能更安全地實作。

## 這個產品是什麼

- 給 AI agent 使用的 MCP 產品規劃 server。
- 專案知識圖譜。
- Ticket 生成系統。
- Coding agent 的上下文層。
- 既有 PM 和開發工具的整合層。

## 初期不是什麼

- Jira、Linear 或 Plane 的完整替代品。
- 完整團隊管理套件。
- 排程或甘特圖工具。
- 通用 mind map 工具。
- 單純的 code agent。
- UI-first Web app。

## 成功標準

MVP 成功的定義：

1. 使用者可以輸入一個模糊想法。
2. AI 可以產出一份清楚的 Product Brief。
3. MCP resources 可以提供有用的 goals、users、pain points、features 和 tickets 圖譜上下文。
4. AI 可以生成足夠明確、可實作的 tickets。
5. 使用者可以選一張 ticket，並給 AI agent 足夠上下文開始實作。
