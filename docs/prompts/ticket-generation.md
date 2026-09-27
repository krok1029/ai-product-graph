# Prompt：Ticket Generation

## 目的

根據 selected graph context 生成可實作 tickets。

## Inputs

- Selected graph node or subgraph
- Product Brief
- Existing tickets
- Constraints

## Output Format

```json
{
  "project_id": "<project id>",
  "source_graph_revision_id": "<current graph revision id>",
  "source_node_ids": ["<source node id>"],
  "tickets": [
    {
      "title": "<可獨立驗證的功能>",
      "user_story": "<使用情境>",
      "scope": [],
      "acceptance_criteria": ["<可驗證結果>"],
      "non_goals": [],
      "related_graph_node_ids": ["<source node id>"],
      "dependencies": [],
      "implementation_targets": [
        { "repository_id": "<repository id>", "scope": ["<repository 範圍>"] }
      ],
      "implementation_notes": []
    }
  ]
}
```

輸出為 `create_ticket_draft_batch` 的 arguments；所有 `<...>` 須替換為真實來源或生成內容，不能把 placeholder 提交為 identity。

## Rules

- 每張 ticket 必須有 acceptance criteria。
- 每張 ticket 必須連到 product context。
- Ticket 要小到足以一次 focused implementation pass 完成。
- 不要產生像「改善 UX」這種沒有明確 criteria 的模糊任務。
