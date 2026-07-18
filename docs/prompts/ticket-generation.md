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
  "tickets": [
    {
      "title": "",
      "user_story": "",
      "scope": [],
      "acceptance_criteria": [],
      "non_goals": [],
      "related_graph_nodes": [],
      "implementation_notes": []
    }
  ]
}
```

## Rules

- 每張 ticket 必須有 acceptance criteria。
- 每張 ticket 必須連到 product context。
- Ticket 要小到足以一次 focused implementation pass 完成。
- 不要產生像「改善 UX」這種沒有明確 criteria 的模糊任務。
