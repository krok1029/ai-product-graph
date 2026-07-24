# MCP Tool Spec

## 設計原則

- MVP 使用少量粗粒度 workflow tools + 必要 read tools。
- Mutating tools 一律回傳 structured summary。
- AI generation 由 client agent 執行，server 不直接呼叫 LLM。
- AI generated content 一律先建立為 draft。
- Destructive tools 不放進第一版。
- Tool input / output 必須可 schema validation。

## 共用型別

### EntityStatus

```ts
type EntityStatus = "draft" | "approved" | "archived";
```

### ToolResult

```ts
type ToolResult<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: ToolErrorCode;
    message: string;
    details?: unknown;
  };
  audit_log_id?: string;
};
```

### ToolErrorCode

```ts
type ToolErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";
```

Error code 使用規則：

- `VALIDATION_ERROR`：input schema、required field、enum 或 business rule 不合法。
- `NOT_FOUND`：指定 entity 不存在，或不屬於目前 project。
- `CONFLICT`：狀態衝突，例如 approve 已 archived 的 entity。
- `STORAGE_ERROR`：SQLite migration、query、transaction 或 persistence failure。
- `INTERNAL_ERROR`：未預期錯誤。

### ProductBriefJson

```ts
type ProductBriefJson = {
  product_goal: string;
  target_users: Array<{
    name: string;
    description: string;
  }>;
  pain_points: Array<{
    title: string;
    description: string;
  }>;
  core_workflows: Array<{
    title: string;
    steps: string[];
  }>;
  mvp_scope: string[];
  non_goals: string[];
  success_metrics: string[];
  risks: string[];
  open_questions: string[];
};
```

## MVP Tools

### create_project

建立 project。

Input：

```json
{
  "name": "AI Product Graph",
  "description": "MCP-first product planning system"
}
```

Output：

```json
{
  "project": {
    "id": "01J...",
    "slug": "ai-product-graph",
    "name": "AI Product Graph"
  }
}
```

Validation：

- `name` required。
- `slug` 由 server 產生，可之後允許 override。

### list_projects

列出 projects。

Input：

```json
{}
```

Output：

```json
{
  "projects": []
}
```

### get_project

讀取 project summary。

Input：

```json
{
  "project_id": "01J..."
}
```

Output：

```json
{
  "project": {},
  "counts": {
    "ideas": 0,
    "graph_nodes": 0,
    "tickets": 0
  }
}
```

### add_idea

新增原始想法。

Input：

```json
{
  "project_id": "01J...",
  "content": "我想做一個...",
  "source": "user"
}
```

Output：

```json
{
  "idea": {
    "id": "01J...",
    "project_id": "01J...",
    "status": "approved"
  }
}
```

Notes：

- 使用者直接輸入的 idea 可視為 approved。
- AI 改寫後的 idea 應另建 draft。

### get_idea

讀取 idea。

Input：

```json
{
  "idea_id": "01J..."
}
```

Output：

```json
{
  "idea": {}
}
```

### create_product_brief_draft

儲存 client agent 產生的 Product Brief draft。

Input：

```json
{
  "project_id": "01J...",
  "source_idea_id": "01J...",
  "brief": {
    "product_goal": "",
    "target_users": [],
    "pain_points": [],
    "core_workflows": [],
    "mvp_scope": [],
    "non_goals": [],
    "success_metrics": [],
    "risks": [],
    "open_questions": []
  }
}
```

Output：

```json
{
  "product_brief": {
    "id": "01J...",
    "status": "draft"
  },
  "validation": {
    "warnings": []
  }
}
```

Validation：

- `brief.product_goal` required。
- JSON schema required fields 必須存在。

### approve_product_brief

把 Product Brief draft 轉成 canonical approved brief。

Input：

```json
{
  "product_brief_id": "01J..."
}
```

Output：

```json
{
  "product_brief": {
    "id": "01J...",
    "status": "approved",
    "approved_at": "2026-07-18T00:00:00.000Z"
  }
}
```

### create_graph_draft

儲存 graph nodes / edges draft。

Input：

```json
{
  "project_id": "01J...",
  "source_product_brief_id": "01J...",
  "nodes": [
    {
      "type": "product_goal",
      "title": "",
      "description": "",
      "metadata": {}
    }
  ],
  "edges": [
    {
      "source_temp_id": "n1",
      "target_temp_id": "n2",
      "relation_type": "supports",
      "confidence": 0.8,
      "metadata": {}
    }
  ]
}
```

Output：

```json
{
  "draft": {
    "node_ids": [],
    "edge_ids": []
  },
  "validation": {
    "warnings": []
  }
}
```

Validation：

- Node type 必須屬於支援清單。
- Edge relation type 必須屬於支援清單。
- Edge endpoints 必須存在於同一 batch 或既有 graph。

### approve_graph_draft

Approve graph draft nodes / edges。

Input：

```json
{
  "project_id": "01J...",
  "node_ids": [],
  "edge_ids": []
}
```

Output：

```json
{
  "approved": {
    "node_ids": [],
    "edge_ids": []
  }
}
```

### get_graph_context

讀取 project graph context。

Input：

```json
{
  "project_id": "01J...",
  "status": "approved",
  "node_types": ["product_goal", "pain_point", "feature_area"],
  "max_depth": 2
}
```

Output：

```json
{
  "nodes": [],
  "edges": []
}
```

### get_node_trace

讀取單一 node 的 trace。

Input：

```json
{
  "node_id": "01J...",
  "direction": "both",
  "max_depth": 3
}
```

Output：

```json
{
  "root": {},
  "nodes": [],
  "edges": [],
  "paths": []
}
```

### create_ticket_drafts

儲存 client agent 產生的 ticket drafts。

Input：

```json
{
  "project_id": "01J...",
  "source_node_ids": ["01J..."],
  "tickets": [
    {
      "title": "",
      "user_story": "",
      "scope": [],
      "acceptance_criteria": [],
      "non_goals": [],
      "related_graph_node_ids": [],
      "implementation_notes": []
    }
  ]
}
```

Output：

```json
{
  "tickets": [
    {
      "id": "01J...",
      "status": "draft"
    }
  ],
  "validation": {
    "warnings": []
  }
}
```

Validation：

- `title` required。
- `acceptance_criteria` 至少一項。
- `related_graph_node_ids` 至少一項，且應包含 product goal 或 pain point trace。

### approve_ticket

Approve ticket。

Input：

```json
{
  "ticket_id": "01J..."
}
```

Output：

```json
{
  "ticket": {
    "id": "01J...",
    "status": "approved"
  }
}
```

### get_ticket_context

讀取 ticket implementation context。

Input：

```json
{
  "ticket_id": "01J...",
  "include_markdown": true
}
```

Output：

```json
{
  "ticket": {},
  "related_nodes": [],
  "related_edges": [],
  "markdown": ""
}
```

### create_implementation_brief_draft

建立 implementation brief draft。Server 不掃 repo，只接受 agent/user 提供的 repo context。

Input：

```json
{
  "ticket_id": "01J...",
  "repo_context": {
    "repository_name": "",
    "summary": "",
    "file_list": [],
    "module_notes": []
  },
  "brief": {
    "implementation_plan": [],
    "suggested_files_to_inspect": [],
    "test_strategy": [],
    "risks": [],
    "pr_summary_draft": ""
  }
}
```

Output：

```json
{
  "implementation_brief": {
    "id": "01J...",
    "status": "draft"
  }
}
```

### export_markdown_draft

把 draft 或 approved entity render 成 Markdown。

Input：

```json
{
  "entity_type": "product_brief",
  "entity_id": "01J..."
}
```

Output：

```json
{
  "markdown": "",
  "suggested_filename": "product-brief-ai-product-graph.md"
}
```

## MVP Resources

```text
product-graph://projects
product-graph://projects/{projectId}
product-graph://projects/{projectId}/brief
product-graph://projects/{projectId}/graph
product-graph://projects/{projectId}/tickets
product-graph://tickets/{ticketId}
product-graph://tickets/{ticketId}/context
product-graph://nodes/{nodeId}
product-graph://nodes/{nodeId}/trace
```

## MVP Prompts

```text
product-brief
extract-graph
generate-tickets
implementation-brief
review-ticket-quality
trace-feature-context
```

Prompts 應回傳 instructions，要求 client agent 產生符合 tool input schema 的 JSON。
