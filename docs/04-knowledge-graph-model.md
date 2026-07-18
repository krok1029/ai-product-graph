# 知識圖譜模型

## 目的

知識圖譜要讓產品上下文可以被追溯：

```text
為什麼要做這個？
這是給誰用的？
哪些 tickets 實作它？
哪些 PR 改了它？
哪些檔案和測試相關？
哪些回饋影響了它？
```

## 初始 Node Types

| Type | 說明 |
| --- | --- |
| `idea` | 原始粗略想法或匯入的想法 |
| `product_goal` | 產品想達成的結果 |
| `persona` | 目標使用者類型 |
| `pain_point` | 使用者問題 |
| `workflow` | 使用者工作流或旅程 |
| `feature_area` | 大型產品能力區塊 |
| `epic` | 一組相關實作工作 |
| `ticket` | 可實作的工作項目 |
| `acceptance_criterion` | 可驗證的完成條件 |
| `decision` | 產品或技術決策 |
| `repository` | 程式碼 repository |
| `code_file` | 原始碼檔案或模組 |
| `pull_request` | 實作工作的 PR |
| `test_case` | 與行為相關的測試 |
| `release` | Release 或 deployment |
| `feedback` | 使用者回饋或驗證結果 |

## 初始 Edge Types

| Relation | 意義 |
| --- | --- |
| `clarifies` | 一個 node 釐清另一個 node |
| `supports` | Node 支援某個 goal 或 decision |
| `solves` | Feature 或 ticket 解決某個 pain point |
| `belongs_to` | 子物件隸屬於父物件 |
| `depends_on` | 某項工作依賴另一個 node |
| `implements` | Ticket 或 PR 實作某個 feature |
| `validated_by` | 行為由測試或回饋驗證 |
| `changed_by` | Code file 被 PR 修改 |
| `traces_to` | 一般追溯關係 |
| `blocked_by` | 工作被另一個 node 阻擋 |

## MVP 儲存模型

本機 MCP server 先用 SQLite tables。Schema 要保持可攜，方便之後遷移到 Postgres。

```text
graph_nodes
  id
  project_id
  type
  title
  description
  source
  external_ref
  metadata
  created_at
  updated_at

graph_edges
  id
  project_id
  source_node_id
  target_node_id
  relation_type
  confidence
  metadata
  created_at
  updated_at
```

## 為什麼先用 SQLite

SQLite 比較適合本機 MCP MVP：

- 不需要外部資料庫。
- 單人 agent workflow 安裝簡單。
- 早期 graph traversal 已經足夠。
- 讓第一個 demo 專注在 agent 是否有用。
- 等需要 hosted usage、團隊協作或 vector search 時，再遷移到 Postgres。

當產品需要 hosted persistence、多使用者或 `pgvector` 時，再移到 Postgres。只有當 graph query 成為瓶頸時，才考慮 Neo4j、Memgraph 或 ArangoDB。

## Graph 品質規則

- 每張 ticket 應該連到至少一個 product goal 或 pain point。
- 每個 feature area 應該連到至少一個 persona 或 workflow。
- 每個 PR 應該連到至少一張 ticket。
- AI 建立的 nodes 在成為 canonical 前應該可以被 review。
- Graph changes 第一版使用簡單 audit log 追蹤，不做完整 event sourcing。
