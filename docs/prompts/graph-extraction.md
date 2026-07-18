# Prompt：Graph Extraction

## 目的

從 approved Product Brief 萃取 draft graph nodes 和 edges。

## Inputs

- Product Brief
- Existing graph nodes
- Existing graph edges

## Output Format

```json
{
  "nodes": [
    {
      "type": "",
      "title": "",
      "description": "",
      "source": "ai_generated",
      "confidence": 0.0
    }
  ],
  "edges": [
    {
      "source_title": "",
      "target_title": "",
      "relation_type": "",
      "confidence": 0.0
    }
  ]
}
```

## Rules

- 只使用支援的 node 和 edge types。
- 避免 duplicate nodes。
- 低 confidence relationships 要能 review。
- 這個階段不要建立 implementation tickets。
