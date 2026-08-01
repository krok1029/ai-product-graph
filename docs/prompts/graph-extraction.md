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
  "reconciliation_summary": "Compared the approved Product Brief Version with the current product-intent graph.",
  "changes": [
    {
      "change_id": "goal-1",
      "operation": "add",
      "entity_kind": "node",
      "target_id": null,
      "payload": {
        "type": "product_goal",
        "title": "",
        "description": "",
        "metadata": {}
      }
    },
    {
      "change_id": "edge-1",
      "operation": "add",
      "entity_kind": "edge",
      "target_id": null,
      "payload": {
        "source_change_id": "goal-1",
        "target_node_id": "01J...",
        "relation_type": "supports",
        "confidence": 0.8,
        "metadata": {}
      }
    }
  ]
}
```

## Rules

- 只使用支援的 node 和 edge types。
- Product Brief extraction 只可修改 `product_goal`、`persona`、`pain_point`、`workflow`、`feature_area` nodes，以及 endpoints 都在此 ownership scope 的 edges。
- 比較 existing graph 後明確產生 `add`、`update`、`archive` changes，不做整張替換或盲目追加。
- 避免 duplicate nodes；identity 不確定時不要猜測 target ID。
- Edge endpoint 可使用既有 node ID，或用同批 node-add 的 `change_id`。
- 若不需要任何 changes，回傳空 `changes` 與非空 `reconciliation_summary`。
- 低 confidence relationships 要能 review。
- 這個階段不要建立 implementation tickets。
