# MCP Tool Spec

## 設計原則

- MVP 使用少量粗粒度 workflow tools + 必要 read tools。
- Mutating tools 一律回傳 structured summary。
- AI generation 由 client agent 執行，server 不直接呼叫 LLM。
- AI generated content 一律先建立為 draft。
- Destructive tools 不放進第一版。
- Tool input / output 必須可 schema validation。

## 共用型別

### ReviewStatus 與 LifecycleStatus

```ts
type ReviewStatus = "draft" | "approved";
type LifecycleStatus = "active" | "archived";
```

- `review_status` 只存在於需要人類審查的內容，例如 Product Brief Version 與 Ticket Revision；穩定 aggregate identity 沒有 `review_status`。
- `lifecycle_status` 適用所有 entities。
- Idea Record、Feedback Record 與 Observed Evidence 沒有 `review_status`。

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
  | "STALE_HANDOFF"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";
```

Error code 使用規則：

- `VALIDATION_ERROR`：input schema、required field、enum 或 business rule 不合法。
- `NOT_FOUND`：指定 entity 不存在，或不屬於目前 project。
- `CONFLICT`：狀態衝突，例如 approve lifecycle 已是 archived 的 entity。
- `STALE_HANDOFF`：Implementation Brief 的產品來源或 repository baseline 已不再 current。
- `STORAGE_ERROR`：SQLite migration、query、transaction 或 persistence failure。
- `INTERNAL_ERROR`：未預期錯誤。

SQLite connection factory 必須在任何 migration、query 或 transaction 前，對每個新 connection 執行 `PRAGMA foreign_keys = ON` 並讀回確認為 `1`。無法啟用或驗證時不得把該 connection 提供給 MCP tools；server startup 或 connection acquisition 必須失敗，而不能在 foreign-key enforcement 關閉的狀態下繼續。所有 pending migrations 完成後、註冊或提供任何 MCP tool／resource 前，server 必須執行 `PRAGMA foreign_key_check`；結果非空時必須回報 storage integrity error 並停止啟動，不得自動刪除或修復資料。

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
    "name": "AI Product Graph",
    "lifecycle_status": "active"
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

### create_repository

在 active Project 登記穩定的 Repository identity，供 Ticket Revision 的 implementation targets、Implementation Brief 與 Observed Evidence 引用。不掃描 filesystem、不連線 remote provider，也不建立外部 repository。

Input：

```json
{
  "project_id": "01JPROJECT...",
  "slug": "app",
  "name": "App Repository",
  "root_path": "/work/app",
  "remote_url": "git@example.com:team/app.git"
}
```

Success `data`（外層 ToolResult 同時回傳本次建立的 `audit_log_id`）：

```json
{
  "repository": {
    "id": "01JREPOSITORY...",
    "project_id": "01JPROJECT...",
    "slug": "app",
    "name": "App Repository",
    "root_path": "/work/app",
    "remote_url": "git@example.com:team/app.git",
    "lifecycle_status": "active",
    "created_at": "2026-09-27T00:00:00.000Z",
    "updated_at": "2026-09-27T00:00:00.000Z"
  }
}
```

Validation 與語意：

- `project_id`、`slug`、`name` 是 required string，經 trim 後不可為空；`slug` 必須符合 `[a-z0-9]+(?:-[a-z0-9]+)*`，長度 1–80。
- `root_path`、`remote_url` 是 optional string 或 `null`。省略、`null` 或 trim 後空白都保存為 `null`；其他值 trim 後原樣保存。它們只是 client 提供的 metadata，不驗證路徑存在、Git 狀態或 remote 可用性，也不依路徑／URL 合併 identities。SSH remote 字串可用。
- 成功時由 server 產生 Repository ULID、active lifecycle 與相同的 created／updated timestamp；Repository 沒有 review status。
- slug 在 Project 內唯一，包含 archived Repository；不同 Projects 可使用相同 slug。重送相同 slug 回傳 conflict，client 可用 `list_repositories` 找回先前 identity；本 tool 不使用 Operation Receipt。
- Repository 與 `repository.created` audit event 在同一 transaction 保存。Audit 記錄 Project、Repository ID、`mcp_client` source、時間及完整建立摘要；它不構成 Approval。
- `VALIDATION_ERROR`：空白 required field 或 slug 格式／長度不合法。缺欄位及型別錯誤由 MCP input schema 拒絕。
- `NOT_FOUND`：Project identity 不存在。
- `CONFLICT`：Project archived，或 Project 已有相同 slug；不重新啟用或改綁既有 Repository。
- `STORAGE_ERROR`：SQLite 寫入失敗，Repository 與 audit 一起 rollback。

### list_repositories

列出指定 active Project 內的 Repository identities，包含 archived 歷史資料；依 `created_at`、`id` 升冪排列。每筆使用與 `create_repository` 相同的完整 Repository shape。空 Project 回傳空陣列，不混入其他 Project 的資料。

Input：

```json
{ "project_id": "01JPROJECT..." }
```

Success `data`：

```json
{ "repositories": [] }
```

- `project_id` 是 required string，trim 後不可為空；空白回傳 `VALIDATION_ERROR`，缺欄位或型別錯誤由 MCP input schema 拒絕。
- `NOT_FOUND`：Project 不存在；`CONFLICT`：Project archived；SQLite 讀取失敗回傳 `STORAGE_ERROR`。
- Read tool 不產生 audit event。後續 Ticket Target 只能引用同 Project 的 active Repository ID，不能以 slug、path 或 remote URL 取代。

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
    "lifecycle_status": "active"
  }
}
```

Notes：

- 使用者直接輸入的內容保存為 canonical Idea Record，但不代表已核准實作。
- Idea Record 沒有 `review_status`。
- AI 改寫後的內容應另建 Idea Interpretation，且 `review_status` 為 `draft`。

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
  "base_approved_version_id": null,
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
    "project_id": "01J...",
    "lifecycle_status": "active",
    "current_approved_version_id": null
  },
  "version": {
    "id": "01J...",
    "version_number": 1,
    "base_approved_version_id": null,
    "review_status": "draft",
    "lifecycle_status": "active"
  },
  "validation": {
    "warnings": []
  }
}
```

Validation：

- `brief.product_goal` required。
- JSON schema required fields 必須存在。
- `base_approved_version_id` 必須等於建立 draft 當下的 current approved version；第一版可以是 `null`。

### approve_product_brief_version

核准不可變的 Product Brief Version，並更新 Product Brief aggregate 的 current approved version pointer。

Input：

```json
{
  "product_brief_version_id": "01J..."
}
```

Validation：

- Version 的 `base_approved_version_id` 必須仍等於 Product Brief 的 current approved version。
- Base mismatch 回傳 `CONFLICT`，不得更新 current approved pointer。
- 核准只更新 Product Brief current pointer，不預先 archive 或重設所有衍生 Tickets。
- 核准後 Product Intent Reconciliation 必須衍生為 `pending`，直到來源為此版本的 Graph Draft Batch 成功核准。

Output：

```json
{
  "product_brief": {
    "id": "01J...",
    "lifecycle_status": "active",
    "current_approved_version_id": "01J..."
  },
  "version": {
    "id": "01J...",
    "review_status": "approved",
    "lifecycle_status": "active",
    "approved_at": "2026-07-18T00:00:00.000Z"
  },
  "product_intent_reconciliation": {
    "status": "pending",
    "current_product_brief_version_id": "01J...",
    "last_reconciled_product_brief_version_id": "01J..."
  },
  "archived_stale_version_ids": []
}
```

### create_graph_draft_batch

儲存一組 graph proposed changes。Review Status 屬於 batch，不屬於個別 proposed node / edge。若 Product Brief Version 與現有 graph 比較後不需要任何 node 或 edge 變更，可建立 no-op reconciliation batch；此時 `changes` 可為空，但必須提供 `reconciliation_summary`。

Input：

```json
{
  "project_id": "01J...",
  "base_graph_revision_id": "01J...",
  "source_product_brief_version_id": "01J...",
  "reconciliation_summary": "Compared the approved Product Brief Version with the current graph; no product-intent nodes or edges need changes.",
  "changes": [
    {
      "change_id": "c1",
      "operation": "add",
      "entity_kind": "node",
      "target_id": null,
      "payload": {
        "type": "product_goal",
        "title": "",
        "description": "",
        "metadata": {}
      }
    }
  ]
}
```

Output：

```json
{
  "graph_draft_batch": {
    "id": "01J...",
    "base_graph_revision_id": "01J...",
    "review_status": "draft",
    "lifecycle_status": "active",
    "change_count": 1,
    "is_noop_reconciliation": false
  },
  "validation": {
    "warnings": [],
    "conflicts": []
  }
}
```

Validation：

- `operation` 必須是 `add`、`update` 或 `archive`。
- `base_graph_revision_id` 必須等於建立 batch 當下的 Project current Graph Revision；graph 尚未建立 revision 時可以是 `null`。
- `changes` 可以為空；空 changes 表示 no-op reconciliation，必須提供非空 `reconciliation_summary`。
- Node type 與 edge relation type 必須屬於支援清單。
- Edge endpoints 必須指向同一 batch 的 proposed node 或既有 active GraphNode。
- Changes 必須位於 Product Brief extraction 的 ownership scope。
- Identity 無法確定時必須回傳 conflict，且 batch 不可核准。
- Product Brief extraction 可修改的 node types 只包含 `product_goal`、`persona`、`pain_point`、`workflow`、`feature_area`。其他 node types 與連到非 ownership-scope nodes 的 edges 不可由此 workflow 修改。
- Node `add` 的 `target_id` 必須是 `null`；payload 必須包含 `type`、`title`，可包含 `description`、`metadata`。
- Edge `add` 的 `target_id` 必須是 `null`；payload 必須包含 `relation_type`，每個 endpoint 必須在既有 `source_node_id`／`target_node_id` 與同批 node-add `source_change_id`／`target_change_id` 之間恰選一種表示。
- Node `update` 只可修改 `title`、`description`、`metadata`；Edge `update` 只可修改 `relation_type`、`confidence`、`metadata`。Update 不可改變 stable identity 或 edge endpoints。
- `archive` 必須使用非空 `target_id` 與空 payload。Node 還有 active edges 時，同一 batch 必須明確 archive 這些 edges，否則產生 conflict。
- `change_id` 在 batch 內必須唯一。相同 generated node slug、重複 edge、inactive target、ownership violation 或無法解析的 endpoint 都必須保存為 validation conflict 並阻止 approval。

### approve_graph_draft_batch

原子核准並套用整個 Graph Draft Batch。

Input：

```json
{
  "graph_draft_batch_id": "01J..."
}
```

Output：

```json
{
  "graph_draft_batch": {
    "id": "01J...",
    "review_status": "approved",
    "lifecycle_status": "active"
  },
  "graph_revision": {
    "id": "01J...",
    "sequence_number": 3,
    "source_product_brief_version_id": "01J..."
  },
  "applied": {
    "added_ids": [],
    "updated_ids": [],
    "archived_ids": [],
    "is_noop_reconciliation": true,
    "reconciliation_summary": "Compared the approved Product Brief Version with the current graph; no product-intent nodes or edges need changes."
  },
  "archived_stale_batch_ids": [],
  "product_intent_reconciliation": {
    "status": "current",
    "current_product_brief_version_id": "01J...",
    "last_reconciled_product_brief_version_id": "01J...",
    "product_intent_graph_revision_id": "01J..."
  }
}
```

Validation：

- Input 不接受個別 node IDs 或 edge IDs。
- Batch 的 `base_graph_revision_id` 必須等於 approval 當下的 Project current Graph Revision。
- Batch 的 `source_product_brief_version_id` 必須等於 approval 當下的 Product Brief current approved version；不相等時回傳 `CONFLICT`，且不得推進 Product Intent Reconciliation。
- Base mismatch 回傳 `CONFLICT` 與目前 revision ID，不得自動 merge 或部分套用。
- Batch 必須沒有 unresolved conflicts。
- 所有 changes 必須在單一 transaction 中全數成功；失敗時不得部分套用。No-op reconciliation batch 不修改任何 GraphNode 或 GraphEdge。
- 成功後必須在同一 transaction 更新 Project 的 `last_reconciled_product_brief_version_id` 與 `product_intent_graph_revision_id`，使 Product Intent Reconciliation 成為 `current`。
- 成功後必須建立 Graph Revision，即使 batch 是 no-op reconciliation。
- 成功後必須在同一 transaction archive 其他 base 已變 stale 的 active Graph Draft Batches。

### get_graph_context

讀取 project graph context。

Input：

```json
{
  "project_id": "01J...",
  "lifecycle_status": "active",
  "node_types": ["product_goal", "pain_point", "feature_area"],
  "max_depth": 2
}
```

Output：

```json
{
  "graph_revision_id": "01J...",
  "nodes": [],
  "edges": []
}
```

Notes：

- Canonical GraphNode 與 GraphEdge 沒有 `review_status`。
- `lifecycle_status` 預設為 `active`。
- 指定 `node_types` 時，符合類型的 nodes 是 traversal seeds，沿符合 lifecycle filter 的 edges 最多擴張 `max_depth`；`max_depth = 0` 只回傳 seed nodes 與 seeds 彼此間的 edges。
- 未指定或傳入空 `node_types` 時，回傳 Project 中符合 lifecycle filter 的完整 graph，`max_depth` 不限制結果。

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

Trace 讀取契約：

- `direction` 可為 `outgoing`（source → target）、`incoming`（target → source）或 `both`；預設 `both`。回傳 edge 仍保留原本的 source／target，不因 traversal 方向反轉。
- `max_depth` 是從 root 計算的最大 edge hops，接受 0–10 的整數，預設 3。0 只回傳 root、空 edges 與 root 的零長度 path。
- 使用 BFS，每個可達 node 只展開一次；cycles 與 self-loops 不會產生無限路徑。`edges` 包含從深度小於上限的 node 按方向走過的全部 edges（包含 cycle edges），不是完整 induced subgraph。
- `paths` 是每個回傳 node 的一條最短路徑，格式為 `{ "node_ids": ["root", "destination"], "edge_ids": ["edge"] }`；包含 root 的 `{ "node_ids": ["root"], "edge_ids": [] }`。不列舉所有可能路徑。相同長度路徑依 BFS 與 edge ID 字典順序選擇，nodes／edges 依 ID 排序，paths 依終點 node ID 排序。
- Project scope 由 root 決定，nodes 與 edges 都必須同屬該 Project，跨 Project endpoints 不會被遍歷。只展開 active nodes 與 active edges；edge 的兩個 endpoints 也必須 active。
- 明確指定 archived root 時可讀取該歷史 node，但 trace 只回傳 root 與零長度 path，不隱含展開歷史 graph。不存在的 root 回傳 `NOT_FOUND`。此查詢不修改資料或建立 audit event。

### create_ticket_draft_batch

儲存 client agent 同一次產生的 Ticket Draft Batch。每個新工作單位會建立穩定 Ticket identity 與第一個 draft Ticket Revision。

Input：

```json
{
  "project_id": "01J...",
  "source_graph_revision_id": "01J...",
  "source_node_ids": ["01J..."],
  "tickets": [
    {
      "title": "",
      "traces_to_ticket_id": null,
      "user_story": "",
      "scope": [],
      "acceptance_criteria": [],
      "non_goals": [],
      "related_graph_node_ids": [],
      "implementation_targets": [
        {
          "repository_id": "01J...",
          "scope": []
        }
      ],
      "implementation_notes": []
    }
  ]
}
```

Output：

```json
{
  "ticket_draft_batch": {
    "id": "01J...",
    "lifecycle_status": "active"
  },
  "tickets": [{
    "ticket": {
      "id": "01J...",
      "lifecycle_status": "active",
      "delivery_status": "planned"
    },
    "revision": {
      "id": "01J...",
      "revision_number": 1,
      "base_approved_revision_id": null,
      "source_graph_revision_id": "01J...",
      "review_status": "draft",
      "lifecycle_status": "active"
    },
    "proposed_implementation_targets": [
      {
        "repository_id": "01J...",
        "scope": []
      }
    ]
  }],
  "validation": {
    "warnings": []
  }
}
```

Validation：

- `title` required。
- 在同一 creation transaction 建立 ID 等於 Ticket ID 的 canonical Ticket node；node 投影 aggregate title／lifecycle。Replacement revision draft 不更新 node，approval 才同步 title。
- Ticket writes 不建立 Graph Revision、不推進 Project reconciliation pointers；既有 Graph Draft Batch 不因 Ticket creation 或 approval 而 stale。
- `source_node_ids` 與 `related_graph_node_ids` 只能引用同 Project active product-intent ownership nodes，不能引用 Ticket projection。
- `acceptance_criteria` 至少一項。
- `implementation_notes` 是 optional string array，省略時預設為 `[]` 並保存於 immutable specification；明確提供的字串沿用 trim／去重 normalization，空白字串或非字串內容仍拒絕。Initial batch 與 replacement revision 共用此契約。
- `traces_to_ticket_id` 若存在，必須指向同一 Project 中的 active 或 archived Ticket；建立後以 `traces_to` edge 保存關係。
- `source_graph_revision_id` 必須是 Project 目前的 Graph Revision。
- `related_graph_node_ids` 至少一項，且應包含 product goal 或 pain point trace。
- `implementation_targets` 至少一項，且每個 target 對應單一 active Repository。
- 同一 Ticket Revision 不得重複相同 `repository_id`。
- First revision 的 stable Implementation Target identities 在 revision approval transaction 建立，draft output 只保存 proposed target specifications。

### create_ticket_revision_draft

為既有 Ticket 建立新的 immutable specification revision draft。

Input：

```json
{
  "ticket_id": "01J...",
  "base_approved_revision_id": "01J...",
  "source_graph_revision_id": "01J...",
  "specification": {
    "title": "",
    "user_story": "",
    "scope": [],
    "acceptance_criteria": [],
    "non_goals": [],
    "related_graph_node_ids": [],
    "dependencies": [],
    "implementation_targets": [
      {
        "repository_id": "01J...",
        "scope": []
      }
    ]
  }
}
```

Output：

```json
{
  "ticket": {
    "id": "01J...",
    "lifecycle_status": "active",
    "current_approved_revision_id": "01J..."
  },
  "revision": {
    "id": "01J...",
    "base_approved_revision_id": "01J...",
    "source_graph_revision_id": "01J...",
    "review_status": "draft",
    "lifecycle_status": "active"
  },
  "proposed_implementation_targets": [
    {
      "implementation_target_id": "01J...",
      "repository_id": "01J...",
      "scope": [],
      "identity_action": "reuse"
    },
    {
      "implementation_target_id": null,
      "repository_id": "01J...",
      "scope": [],
      "identity_action": "create_on_approval"
    }
  ],
  "archived_stale_revision_ids": []
}
```

Validation：

- `base_approved_revision_id` 必須等於建立 draft 當下的 Ticket current approved revision。
- `specification.implementation_notes` 可省略，預設與 initial batch 相同為 `[]`，不從舊 revision 繼承。建立 draft 不改動 Ticket current approved pointer、Delivery Status 或舊 revision。
- `source_graph_revision_id` 必須是 Project 目前的 Graph Revision。
- Repository 已有同一 Ticket 的 active Implementation Target 時，draft 必須 reuse 該 identity；不得為同一 Repository 建立第二個 active Target。
- Repository 只有 archived Target 時，draft 必須標示 `create_on_approval`，不得直接復活 archived identity。

### approve_ticket_revision

Approve 單一 Ticket Revision。Ticket Draft Batch 不是原子核准單位。

Input：

```json
{
  "ticket_revision_id": "01J..."
}
```

Output：

```json
{
  "ticket": {
    "id": "01J...",
    "lifecycle_status": "active",
    "delivery_status": "planned",
    "current_approved_revision_id": "01J..."
  },
  "revision": {
    "id": "01J...",
    "review_status": "approved",
    "lifecycle_status": "active"
  },
  "implementation_targets": [
    {
      "id": "01J...",
      "repository_id": "01J...",
      "lifecycle_status": "active",
      "identity_action": "reused"
    }
  ],
  "archived_implementation_target_ids": [],
  "archived_implementation_brief_ids": [],
  "archived_implementation_result_ids": [],
  "created_sync_intent_ids": []
}
```

Validation：

- Revision 的 `base_approved_revision_id` 必須仍等於 Ticket 的 current approved revision。
- Base mismatch 回傳 `CONFLICT`，不得更新 current approved pointer。
- Revision 引用的產品意圖必須仍是 active。
- Revision 的相依 Tickets 必須已有 approved revision，或在同一次操作中一起核准。
- 同一 Repository 的 existing active Implementation Target 必須沿用；新增 Repository 才建立新 identity。
- 新 approved revision 移除的 active Targets 必須 archive；對其 active repository-specific mappings 建立 close Sync Intents。
- Archived Target 日後重新加入時必須建立新 identity，不得 unarchive。
- Replacement revision approval 必須把 Ticket Delivery Status 重設為 `planned`，不得保留舊 revision 的 `in_progress`、`blocked` 或 `done`。
- Replacement revision approval 必須以 `source_revision_superseded` archive 綁定舊 revision 的所有 active Implementation Briefs 與 Implementation Results；保留它們的 Review Status、Acceptances 與 evidence。
- Target reconciliation、current revision pointer update、Delivery Status reset、archive old artifacts、archive removed targets 與 Sync Intent creation 必須在同一 transaction 完成。
- Active External Work Item mappings 必須收到新版 content 與 `planned` status 的 Sync Intents；外部同步失敗不回滾 approval。
- 成功後必須在同一 transaction archive 其他 base 已變 stale 的 active Ticket Revisions。

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
  "revision": {},
  "related_nodes": [],
  "related_edges": [],
  "traced_ticket": null,
  "trace_edge": null,
  "markdown": ""
}
```

目前 lineage 由持久化且 active 的 canonical `traces_to` edge 決定：`trace_edge` 回傳完整 edge，`traced_ticket` 回傳原 Ticket（包含 archived 歷史來源）。沒有關係時兩者皆為 `null`。未核准的 replacement draft 不改目前關係。相同欄位也由 Ticket context resource 提供；讀取不修改任何資料。原 Ticket archived 時仍可由 context 查看，但 `get_node_trace` 維持 active-only traversal，不展開 archived node。

### create_implementation_brief_draft

建立 implementation brief draft。Server 不掃 repo，只接受 agent/user 提供的 repo context。

Input：

```json
{
  "implementation_target_id": "01J...",
  "supersedes_implementation_brief_id": null,
  "repo_context": {
    "repository_name": "",
    "summary": "",
    "file_list": [],
    "module_notes": [],
    "baseline_commit_sha": "abc123...",
    "has_uncommitted_changes": false,
    "dirty_state_fingerprint": null
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

Validation：

- `implementation_target_id` 必須屬於 active approved Ticket Revision。
- Repository Context Snapshot 的 repository identity 必須符合 Implementation Target。
- Ticket Revision 引用的產品意圖 nodes 必須仍是 active 且自該 revision 核准後未變更。
- Ticket dependencies 必須仍有效。
- `supersedes_implementation_brief_id` 若存在，必須指向同一 Implementation Target 的 Implementation Brief；可以是同 revision 的 active predecessor，或 prior revision 的 archived predecessor。

Output：

```json
{
  "implementation_brief": {
    "id": "01J...",
    "supersedes_implementation_brief_id": null,
    "review_status": "draft",
    "lifecycle_status": "active"
  }
}
```

### approve_implementation_brief

核准 Implementation Brief。若同一 Implementation Target 已有 active approved brief，新 brief 必須明確 supersede 舊 brief。

Input：

```json
{
  "implementation_brief_id": "01J..."
}
```

Output：

```json
{
  "implementation_brief": {
    "id": "01J...",
    "review_status": "approved",
    "lifecycle_status": "active",
    "supersedes_implementation_brief_id": "01J..."
  },
  "archived_implementation_brief_id": "01J..."
}
```

Validation：

- Repository Context Snapshot 必須符合 approval 所需的 baseline 規則。
- 同一 Implementation Target 最多只能有一份 active approved brief。
- 若已有 active approved brief，新 brief 的 `supersedes_implementation_brief_id` 必須指向它。
- 若沒有 active approved brief，`supersedes_implementation_brief_id` 可選擇指向最近的 archived approved predecessor 作為 lineage，但不得改變 predecessor Lifecycle Status。
- 核准新 brief 與 archive 被取代 brief 必須在單一 transaction 中完成。

### get_implementation_handoff

在交給 coding agent 前驗證 approved Implementation Brief 的產品來源與 repository freshness。只有 `current` 時才回傳 handoff payload。

Input：

```json
{
  "implementation_brief_id": "01J...",
  "current_repository_state": {
    "commit_sha": "abc123...",
    "dirty_state_fingerprint": null
  }
}
```

Output：

```json
{
  "freshness": "current",
  "implementation_brief": {},
  "implementation_target": {},
  "ticket_revision": {},
  "product_brief_version": {},
  "repository_context_snapshot": {}
}
```

Validation：

- Project 的 Product Intent Reconciliation 必須是 `current`；否則回傳 `STALE_HANDOFF`，reason 為 `product_intent_unreconciled`。
- Implementation Brief 必須是 active approved。
- 綁定的 Ticket Revision 必須仍是 Ticket 的 current approved revision。
- 綁定的 Product Brief Version 只作為生成 provenance；reconciliation 完成後，不得僅因 current Product Brief pointer 不同而判定 stale。
- Ticket Revision 引用的產品意圖 nodes 必須仍是 active，且 `last_changed_in_graph_revision_id` 不得晚於 Ticket Revision 的 `source_graph_revision_id`；dependencies 必須仍有效。
- 所有具有 Lifecycle Status 的來源 entities 必須是 active，包括 Project、Product Brief aggregate/version、Ticket/Revision、Implementation Target、Repository、Implementation Brief 與引用的 graph nodes。
- 不具有 Lifecycle Status 的 Repository Context Snapshot 與 Graph Revision 必須存在且可驗證；snapshot 必須屬於同一 Project/Repository 並具有可核准 baseline，graph provenance 與 reconciliation record 必須符合來源 Project/Version。來源 identity、revision ownership 與 required target membership 也必須一致。
- 不存在的 requested Implementation Brief 回傳 `NOT_FOUND`；已存在 brief 的來源缺失、不符或無法驗證回傳 `STALE_HANDOFF`，details 包含 reason 與來源識別。Storage read failures 保留原錯誤；此 read 不修改來源 entities 或交付狀態；handoff observability 的 audit 要求仍依 ADR 0019。
- Commit SHA 與 dirty-state fingerprint 必須符合 Repository Context Snapshot。
- 任一條件不符或無法驗證時回傳 `STALE_HANDOFF`，且不得輸出 handoff payload。

Observability：

- 每次成功 handoff 保存 `implementation_handoff.succeeded` audit；既有 Brief 因 stale 阻擋時保存 `implementation_handoff.blocked`。兩者均以 Brief 為 entity，保存 Project、server LocalActor 與同一 event time；stale 摘要包含 reason 與來源識別 details。
- Audit transaction 會初始化／更新目前設定的 LocalActor；不改寫來源 artifacts、Ticket 狀態、Graph Revision、Result、Acceptance 或 Operation Receipt。此為每次嘗試的觀測紀錄，沒有 idempotency replay。
- Stale audit 必須先提交，再回傳原 `STALE_HANDOFF`。未知 requested Brief 的 `NOT_FOUND` 與 storage read failure 不產生 handoff event；storage read failure 不可被誤判為 stale。
- Audit 不保存原始 client repository context、current commit SHA 或 dirty-state fingerprint。回傳既有 data/error shape 不變。
- Audit 寫入失敗時回傳 `STORAGE_ERROR`，actor 與 audit 一起 rollback，不回報 handoff 成功或已記錄的 stale event。


### record_observed_evidence

保存由本機 MCP client 提供、通過格式與 repository identity 驗證的 Observed Evidence。此 tool 只記錄機器回報的可追溯 evidence，不代表 implementation 已被接受，也不會改變 Ticket Delivery Status。

Input：

```json
{
  "project_id": "01J...",
  "repository_id": "01J...",
  "evidence_type": "test_execution",
  "idempotency_key": "repo-01J-test-pnpm-test-2026-07-24T00:00:00.000Z",
  "payload": {
    "schema_version": 1,
    "command": "pnpm test",
    "status": "passed",
    "started_at": "2026-07-24T00:00:00.000Z",
    "completed_at": "2026-07-24T00:01:00.000Z",
    "exit_code": 0,
    "summary": ""
  }
}
```

Output：

```json
{
  "observed_evidence": {
    "id": "01J...",
    "project_id": "01J...",
    "repository_id": "01J...",
    "evidence_type": "test_execution",
    "idempotency_key": "repo-01J-test-pnpm-test-2026-07-24T00:00:00.000Z",
    "payload_hash": "sha256:abc123...",
    "lifecycle_status": "active",
    "created_at": "2026-07-24T00:01:00.000Z"
  },
  "created": true
}
```

若同一 Project 內同一 idempotency key 已存在，但 repository、evidence type 或 payload hash 任一不同，Output：

```json
{
  "ok": false,
  "error": {
    "code": "CONFLICT",
    "message": "Observed evidence idempotency key was reused with different evidence identity or payload.",
    "details": {
      "existing_observed_evidence_id": "01J...",
      "existing_repository_id": "01J...",
      "submitted_repository_id": "01J...",
      "existing_evidence_type": "test_execution",
      "submitted_evidence_type": "commit",
      "existing_payload_hash": "sha256:abc123...",
      "submitted_payload_hash": "sha256:def456..."
    }
  }
}
```

Validation：

- `project_id` required，且 Project 必須 active。
- `repository_id` required，必須屬於同一 Project 且 Repository 必須 active。
- Input 不接受 `implementation_target_id`；Observed Evidence 只綁定 Repository，Implementation Target binding 由 `submit_implementation_result` 透過 Implementation Brief / Target / Ticket Revision 建立。
- `evidence_type` 必須是 `commit`、`pull_request`、`test_execution` 或 `artifact`。
- `idempotency_key` required，且必須在 Project 內唯一，不是 Repository 內唯一；若同一 Project 內同一 key 已存在，只有 existing row 的 `repository_id`、`evidence_type` 與 `payload_hash` 都等於本次請求，tool 才能回傳既有 Observed Evidence 並標示 `created: false`。
- Input 不接受 `payload_hash`；server 必須先對 validated payload 套用 schema-defined semantic normalization，再使用 RFC 8785 JSON Canonicalization Scheme 產生 canonical bytes，並計算 SHA-256 `payload_hash`。
- `payload_json` 必須保存實際被 SHA-256 hash 的 RFC 8785 canonical JSON UTF-8 文字；Phase 1A 不保存 client 原始 payload。
- 若同一 Project 內同一 `idempotency_key` 已存在，但 `repository_id`、`evidence_type` 或 `payload_hash` 任一不同，必須回傳 `CONFLICT`，不得改寫或建立新的 Observed Evidence。
- `payload` 必須符合該 evidence type 的 schema。
- Phase 1A 的四種 evidence payload schema 均為 closed schema，等同 JSON Schema `additionalProperties: false`；任何未宣告欄位必須被拒絕，不得進入 canonical payload 或 `payload_hash`。
- `payload` 內所有 timestamp fields 必須使用固定的 UTC 毫秒格式 `YYYY-MM-DDTHH:mm:ss.sssZ`；不接受時區 offset、缺少毫秒或其他精度。Server 必須先驗證此格式，再計算 `payload_hash`。
- Observed Evidence 沒有 `review_status`，也不需要 Approval。
- Tool 不接受 AI summary、criterion verdict 或 acceptance claim；這些屬於 Evidence Interpretation 或 Implementation Result。
- 成功保存 evidence 不得改變 Implementation Result、Result Acceptance 或 Ticket Delivery Status。

Observed Evidence payload schemas：

四種 payload 都是 closed schema，未列出的欄位一律拒絕。每種 payload 都必須包含 `schema_version`；Phase 1A 只接受整數 `1`。除非個別 schema 另有說明，所有 timestamp fields 均使用 `YYYY-MM-DDTHH:mm:ss.sssZ`。

`commit`：

```json
{
  "schema_version": 1,
  "commit_sha": "abc123...",
  "message": "Implement ticket workflow",
  "authored_at": "2026-07-24T00:00:00.000Z",
  "committed_at": "2026-07-24T00:01:00.000Z",
  "parent_shas": ["def456..."],
  "changed_files": ["src/index.ts"]
}
```

Required fields：

- `schema_version`
- `commit_sha`
- `committed_at`
- `changed_files`

`changed_files` 必須是 string array，欄位不可省略但可為空陣列 `[]`。每個 entry 必須是 repository-relative POSIX path；絕對路徑、反斜線與 `..` path segment 必須被拒絕。Server 必須在計算 `payload_hash` 前去除重複 entry，並以 Unicode code point lexical order 排序。空陣列只表示該 commit 沒有觀測到檔案變更，不代表任何 acceptance criterion 已滿足。

`pull_request`：

```json
{
  "schema_version": 1,
  "provider": "github",
  "external_id": "123",
  "url": "https://github.com/acme/repo/pull/123",
  "title": "Implement ticket workflow",
  "source_branch": "feature/tickets",
  "target_branch": "main",
  "status": "open",
  "head_commit_sha": "abc123...",
  "created_at": "2026-07-24T00:00:00.000Z",
  "updated_at": "2026-07-24T00:01:00.000Z"
}
```

Required fields：

- `schema_version`
- `provider`
- `external_id`
- `url`
- `title`
- `status`
- `head_commit_sha`

Allowed `status` values：

- `draft`
- `open`
- `merged`
- `closed`

`test_execution`：

```json
{
  "schema_version": 1,
  "command": "pnpm test",
  "status": "passed",
  "started_at": "2026-07-24T00:00:00.000Z",
  "completed_at": "2026-07-24T00:01:00.000Z",
  "exit_code": 0,
  "summary": "",
  "log_artifact_ref": null
}
```

Required fields：

- `schema_version`
- `command`
- `status`
- `started_at`
- `completed_at`
- `exit_code`

Allowed `status` values：

- `passed`
- `failed`
- `errored`
- `cancelled`

`exit_code` consistency rules：

- `passed`：必須是 `0`。
- `failed`：必須是非零整數。
- `errored`：可為 `null` 或整數。
- `cancelled`：可為 `null` 或整數。

`exit_code` 欄位本身仍為 required；只有 `errored` 與 `cancelled` 允許其值為 `null`。

`completed_at` 必須晚於或等於 `started_at`；時間倒置的 payload 必須被拒絕。

`artifact`：

```json
{
  "schema_version": 1,
  "artifact_type": "file",
  "name": "coverage.json",
  "uri": "file://relative-or-client-resolved-reference",
  "content_hash": "sha256:abc123...",
  "created_at": "2026-07-24T00:01:00.000Z",
  "description": ""
}
```

Required fields：

- `schema_version`
- `artifact_type`
- `name`
- `uri`
- `content_hash`
- `created_at`

### submit_implementation_result

提交 coding agent 的不可變候選結果。Observed Evidence 可先經 evidence ingestion 成為 canonical；summary 與 criterion verdicts 屬於 draft interpretation。

Input：

```json
{
  "implementation_brief_id": "01J...",
  "supersedes_implementation_result_id": null,
  "observed_evidence_ids": ["01J..."],
  "summary": "",
  "criterion_verdicts": [
    {
      "acceptance_criterion_id": "01J...",
      "verdict": "satisfied",
      "reason": "The referenced test execution passed the criterion's required behavior.",
      "evidence_ids": ["01J..."]
    }
  ],
  "unfinished_items": []
}
```

Output：

```json
{
  "implementation_result": {
    "id": "01J...",
    "implementation_brief_id": "01J...",
    "supersedes_implementation_result_id": null,
    "review_status": "draft",
    "lifecycle_status": "active",
    "submission_disposition": "reviewable",
    "stale_at_submission": false,
    "stale_reasons": []
  }
}
```

若來源已 stale，Output 改為：

```json
{
  "implementation_result": {
    "id": "01J...",
    "implementation_brief_id": "01J...",
    "supersedes_implementation_result_id": null,
    "review_status": "draft",
    "lifecycle_status": "archived",
    "submission_disposition": "stale_archived",
    "stale_at_submission": true,
    "stale_reasons": ["ticket_revision_not_current"]
  },
  "observed_evidence_ids": ["01J..."]
}
```

Validation：

- Implementation Brief 必須存在，且 Result 永久綁定該 brief 的 Ticket Revision 與 Implementation Target。
- Evidence references 必須存在並屬於 target Repository；同一 Observed Evidence 可被多個 Implementation Results 引用，只要每個 Result 的 Implementation Target 都屬於該 Repository。
- Evidence references 不需要預先綁定 Implementation Target；每個 Result 本身才是 evidence 與該 Implementation Target 的綁定點。
- Top-level `observed_evidence_ids` 定義該 Result 引用的完整 evidence set；每個 `criterion_verdicts[].evidence_ids` 必須是此集合的子集。任何 criterion 引用集合外的 Observed Evidence 都必須回傳 validation error，不得建立 Result。
- Top-level `observed_evidence_ids` 可包含未被任何 `criterion_verdicts[].evidence_ids` 引用的 Observed Evidence；這些 evidence 可支撐 Result summary、unfinished items 或整體實作 provenance，但不支撐任何 acceptance criterion，也不得影響 Result Acceptance。
- `supersedes_implementation_result_id` 若存在，必須指向同一 Implementation Target 的 active approved Result。
- 每個 acceptance criterion 必須具有 verdict。`criterion_verdicts[].verdict` 只允許 `satisfied` 或 `unsatisfied`；若 client 提交 `waived`、`waiver_decision_id` 或任何 waiver decision payload，必須回傳 validation error。`satisfied` 必須提供 trim 後非空的 `reason`，簡述所引用 evidence 如何支撐 criterion，否則回傳 validation error；draft Result 可暫時保存 `evidence_ids` 為空但 reason 有效的 `satisfied` verdict，但該 Result 不具 acceptance eligibility。`unsatisfied` 也必須提供 trim 後非空的 `reason`，否則回傳 validation error；其 `evidence_ids` 可為空，也可引用 failed test 等反證。`submit_implementation_result` 不得建立 Waiver Decision；所有 submission verdict、reason 與 evidence references 在建立後不可由 Result Acceptance 修改。
- Evidence ingestion 與 Result review eligibility 必須分開判定；格式與引用有效的 Observed Evidence 即使 handoff source 已 stale 仍應保存。
- 若 Product Intent Reconciliation 為 `pending`，Result 必須建立為 archived draft，並加入 `product_intent_unreconciled` stale reason。
- 若綁定的 Ticket Revision、Implementation Target、referenced intent nodes、dependencies 或其他相關 handoff source 在提交時已 stale，Result 必須建立為 archived draft，記錄 `stale_at_submission` 與 reasons，不回傳 validation error 丟棄整份提交。Reconciliation 完成後，Product Brief provenance pointer 不同本身不構成 stale。
- Stale archived Result 不得 supersede active approved Result，不得執行 Result Acceptance，也不得改變 Ticket Delivery Status。
- Client 可跨 Implementation Results 重用已保存的 evidence references，但每個 Result 的 criterion verdicts 必須獨立建立；其他 Result 的 verdicts 或 Result Acceptance 不得隨 evidence reference 一併沿用。

### accept_implementation_result

執行 Result Acceptance，把 draft Implementation Result 核准為 approved，並在所有 required targets 完成時更新 Ticket Delivery Status。

Input：

```json
{
  "idempotency_key": "accept-result-01J-2026-07-24T00:00:00.000Z",
  "implementation_result_id": "01J...",
  "waivers": [
    {
      "acceptance_criterion_id": "01J...",
      "reason": "The unmet criterion is acceptable for this result because the scoped MVP excludes that behavior."
    }
  ]
}
```

Output：

```json
{
  "implementation_result": {
    "id": "01J...",
    "review_status": "approved",
    "lifecycle_status": "active"
  },
  "result_acceptance": {
    "id": "01J...",
    "project_id": "01J...",
    "implementation_result_id": "01J...",
    "actor_id": "01J...",
    "accepted_at": "2026-07-24T00:00:00.000Z"
  },
  "criterion_outcomes": [
    {
      "id": "01J...",
      "result_acceptance_id": "01J...",
      "acceptance_criterion_id": "01J...",
      "submitted_verdict_id": "01J...",
      "outcome": "waived",
      "waiver_decision_id": "01J...",
      "created_at": "2026-07-24T00:00:00.000Z"
    }
  ],
  "waiver_decisions": [
    {
      "id": "01J...",
      "project_id": "01J...",
      "decision_type": "acceptance_criterion_waiver",
      "summary": "The unmet criterion is acceptable for this result because the scoped MVP excludes that behavior.",
      "actor_id": "01J...",
      "created_at": "2026-07-24T00:00:00.000Z"
    }
  ],
  "archived_result_ids": [],
  "ticket": {
    "id": "01J...",
    "delivery_status": "done"
  }
}
```

Validation：

- Project 的 Product Intent Reconciliation 必須是 `current`。
- `idempotency_key` required，且唯一範圍是同一 Project、目前 Local Actor、`accept_implementation_result` operation。Server 必須先用 closed schema 與語意規則 normalize command：包含 `implementation_result_id`、trim 後的 waiver reasons，以及依 approved Ticket Revision acceptance criteria 原始順序排列的 waivers；`idempotency_key` 本身不參與 command fingerprint。Server 必須使用 RFC 8785 JSON Canonicalization Scheme 對 normalized command 產生 canonical bytes，再用 SHA-256 計算 `normalized_command_hash`，並在成功 transaction 中保存 Operation Receipt。
- Input 不直接包含 `project_id`。Server 必須先以 `implementation_result_id` 做 identity-only resolution，僅確認 Result identity 存在並解析其 Project scope；此步不得驗證 Result 是否為 active draft、是否已有 Acceptance、handoff source 是否 current，或其他 lifecycle／business state。
- 若 `implementation_result_id` 不存在，identity-only resolution 必須立即回傳 `NOT_FOUND`；server 不得在無法解析 Project scope 時查找或建立 Operation Receipt。
- Operation Receipt lookup 必須先於 Result target state validation。Server 必須先查同一 Project、Local Actor、operation 與 `idempotency_key` 的 receipt；若命中且 normalized command hash 相同，直接 replay，不得因 Result 現在已非 active draft、已有 Acceptance 或其他由原成功 transaction 造成的狀態變化而回傳 `CONFLICT`。
- 只有 Operation Receipt miss 時，server 才能繼續執行下列完整 Result target state validation。
- 若同一 Project、Local Actor、operation 與 `idempotency_key` 已有 Operation Receipt，且 normalized command hash 相同，tool 必須回放 receipt 中保存的原始成功 response data，不得重新建立 Acceptance、Outcomes、Waiver Decisions、archive domain rows 或 Ticket status update。
- 若同一 Project、Local Actor、operation 與 `idempotency_key` 已存在但 normalized command hash 不同，必須回傳 `CONFLICT`。不得把既有 Result Acceptance uniqueness error 假裝成 idempotent success，也不得覆寫 receipt 或 response。
- 若同一 normalized command 使用不同 `idempotency_key` 重送，必須視為新的 logical command。若該 Result 已因先前成功 acceptance 而不再是 active draft，或已存在 Result Acceptance，必須回傳一般 `CONFLICT`；不得依 `implementation_result_id` 或既有 Result Acceptance 反查 Operation Receipt 並當作 replay。
- 首次成功時建立的 Operation Receipt 必須只綁定本次 Result Acceptance：`result_acceptance_id` 必須等於新建 Acceptance ID，`result_revocation_id` 必須為 null，且 `operation_name` 必須是 `accept_implementation_result`。同一 Result Acceptance 最多只能有一筆 Operation Receipt，不得讓不同 idempotency keys 指向同一 Acceptance。
- Operation Receipt 只在成功提交 domain transaction 後保存。Validation error、`NOT_FOUND`、`CONFLICT`、`STALE_HANDOFF`、`STORAGE_ERROR` 或其他失敗 response 不得保存；修正失敗原因後，相同 `idempotency_key` 可重新嘗試，除非已有成功 receipt。
- 成功建立 receipt 後，該 Operation Receipt、Result Acceptance 與作為 target identity 的 Implementation Result 都不得 hard delete。Implementation Result 退出有效範圍時只能 archive；Receipt 與 Acceptance 沒有 Lifecycle Status，必須永久保留。
- SQLite delete guards 必須無條件拒絕刪除 Operation Receipt 與 Result Acceptance，並在 Implementation Result 已可經 Acceptance 或 Revocation 連到任一 Receipt 時拒絕刪除該 Result。
- Operation Receipt 的 `response_json` 只保存 successful `ToolResult.data` 的 RFC 8785 canonical JSON UTF-8 text，且不得保存完整 `{ ok, data, error, audit_log_id }` envelope。Replay 時 server 必須 parse 保存的 data 並重新組成目前標準的 `{ ok: true, data, audit_log_id? }`；若原始成功 response 有 `audit_log_id`，該 ID 必須由 receipt 的 audit log reference 重新帶回。
- Replay 必須保持 `data` 完全等同原始成功的 domain response data，不得在 `data` 中新增 `replayed`、`receipt_id`、`idempotency_key` 或其他 replay／receipt marker。
- Replay observability 只能透過 audit log、server log，或未來明確定義的非 domain envelope metadata 表示；不得改變 `ToolResult.data` shape 或內容。
- 若 replay 本身建立 observability log，該 log ID 不得取代 replay response 的 top-level `audit_log_id`。Replay response 的 `audit_log_id` 必須是 receipt 保存的原始成功 domain transaction audit log ID；若原始成功 response 沒有 `audit_log_id`，replay 也不得因 replay observability 產生新的 top-level `audit_log_id`。
- Input 是 closed schema；不得包含 `actor_id`、`accepted_at`、`approved_by`、`approved_by_actor_id`、`approved_at` 或其他 acceptance actor/time 欄位。Server 必須從目前 Local Actor 取得 `Result Acceptance.actor_id`；不得信任、靜默忽略或保存 client-provided values。
- Result 必須是 active draft。
- Receipt miss 後，綁定的 Implementation Brief 必須仍為 active approved；綁定的 Product Brief Version 也必須仍為 active approved，但不要求是 current pointer。Brief 已被替代或來源已封存時回傳 `STALE_HANDOFF`；既有成功 receipt replay 不受這些後續狀態變更影響。
- Result 不得已有任何 Result Acceptance 紀錄；每個 Implementation Result 最多只能接受一次，即使既有 Acceptance 後來被撤銷也不得重新接受。
- `stale_at_submission = true` 或 Lifecycle Status 為 archived 的 Result 必須拒絕 acceptance。
- 同一 Implementation Target 最多只能有一份 active approved Result。
- 若 target 已有 active approved Result，新 Result 必須明確 supersede 它。
- 綁定的 Ticket Revision 必須仍是 current approved，Implementation Target 必須仍屬於該 revision；referenced intent nodes 必須 active 且自 `source_graph_revision_id` 後未變更，dependencies 必須仍有效。
- 綁定的 Product Brief Version 只作為 provenance；reconciliation 完成後，不要求等於 Product Brief current approved pointer。
- 每個 criterion 必須建立最終 `satisfied` 或 `waived` Result Acceptance Criterion Outcome。每個 `satisfied` outcome 只能引用 submission 中同 criterion 的 `satisfied` verdict；該 verdict 必須具有 trim 後非空的 `reason`，並至少引用一份存在於該 Result evidence set 的 Observed Evidence。Reason 或 evidence list 不合法會阻止 acceptance。Input `waivers` 只能指定 submission 中已是 `unsatisfied` 的 acceptance criterion，且必須提供 trim 後非空的 waiver reason；指定 `satisfied`、不存在或重複的 criterion 必須回傳 validation error。`accept_implementation_result` 必須以同一 Local Actor 在同一 transaction 中建立 `decision_type = acceptance_criterion_waiver` 的 Waiver Decision 與 `waived` outcome；該 outcome 必須同時引用原 `unsatisfied` Verdict 與 Waiver Decision，且不得綁定其他 decision type。Result Acceptance 的 `project_id` 必須非空；Outcome 所引用 Verdict 的 Implementation Result 與 Waiver Decision 必須屬於同一 Project。Waiver Decision 的 `project_id` 必須由 Acceptance 衍生；input `waivers[]` 不接受 client-provided `project_id`、`decision_type` 或既有 Decision ID。Trim 後的 `waivers[].reason` 必須寫入 `Decision.summary`；waiver 使用者與時間必須使用 `Decision.actor_id`、`Decision.created_at`，且 actor 必須等於 Result Acceptance actor。Outcome 不得複製 waiver reason、actor 或 time。原 Verdict 的 verdict、reason 與 evidence references 不得修改；顯示 waiver 資訊時讀取 Decision。任何未被 waiver input 指定的 `unsatisfied`，以及任何未驗證 criterion，都會阻止 acceptance。
- Ticket 只有在目前 approved Ticket Revision 的所有 required targets 都具有 active approved Result 時才更新為 `done`；否則維持目前 Delivery Status。
- Waiver Decision、criterion outcomes、Acceptance、archive 被 supersede Result 與 archive 其他 draft attempts 必須在單一 transaction 中完成。
- Server 必須在 transaction 開始時只擷取一次 canonical event time。`Result Acceptance.accepted_at`、每筆 `criterion_outcomes[].created_at` 與每筆本次建立的 `waiver_decisions[].created_at` 必須使用該同一值並完全相等，不得逐筆重新讀取 clock。
- Output 每筆 `criterion_outcomes` 必須回傳完整 canonical fields：`id`、`result_acceptance_id`、`acceptance_criterion_id`、`submitted_verdict_id`、`outcome`、`waiver_decision_id`、`created_at`。`result_acceptance_id` 必須等於同一 response 的 `result_acceptance.id`；`created_at` 必須等於 `result_acceptance.accepted_at`；`satisfied` outcome 的 `waiver_decision_id` 必須明確回傳 `null`。
- `criterion_outcomes` 必須依 approved Ticket Revision 中 `acceptance_criteria` 的原始陣列順序回傳，不得依資料庫 row order、Outcome ID 或 criterion ID 排序。`waiver_decisions` 必須依各 Decision 所對應 Outcome 在 `criterion_outcomes` 中的位置回傳。
- Output 必須以完整 `waiver_decisions` objects 回傳本次建立的 Waiver Decisions，不得只回傳 Decision IDs。每個 `waived` criterion outcome 的 `waiver_decision_id` 必須在 `waiver_decisions` 中恰好對應一個 object；`satisfied` outcome 不得產生 Waiver Decision。
- Output `result_acceptance` 必須回傳完整 canonical fields：`id`、`project_id`、`implementation_result_id`、`actor_id`、`accepted_at`。其中 Project 與 Result 必須與同一 response 的 Implementation Result 一致，server-derived actor 必須與本次建立的 Waiver Decisions 一致。`actor_id` 與 `accepted_at` 是接受操作者與時間的唯一權威來源；Implementation Result 不得保存或回傳 `approved_by`、`approved_by_actor_id` 或 `approved_at`。

### revoke_result_acceptance

撤銷一項在作成當時即無效且目前仍有效的 Result Acceptance，不要求 Ticket 已是 `done`。此操作保留原 Result、Acceptance、criterion outcomes 與 evidence 的歷史，只撤銷它們對目前完成狀態的效力。撤銷後該 Result 永久 archived，不能重新接受；修正必須提交新的 Implementation Result。

Input：

```json
{
  "idempotency_key": "revoke-acceptance-01J-2026-07-24T00:00:00.000Z",
  "result_acceptance_id": "01J...",
  "reason": "",
  "next_delivery_status": "in_progress"
}
```

Output：

```json
{
  "implementation_result": {
    "id": "01J...",
    "review_status": "approved",
    "lifecycle_status": "archived"
  },
  "result_revocation": {
    "id": "01J...",
    "project_id": "01J...",
    "result_acceptance_id": "01J...",
    "decision_id": "01J...",
    "previous_delivery_status": "done",
    "resulting_delivery_status": "in_progress"
  },
  "decision": {
    "id": "01J...",
    "project_id": "01J...",
    "decision_type": "result_acceptance_revocation",
    "summary": "The acceptance relied on invalid test evidence.",
    "actor_id": "01J...",
    "created_at": "2026-07-24T00:00:00.000Z"
  },
  "ticket": {
    "id": "01J...",
    "delivery_status": "in_progress"
  }
}
```

Validation：

- `idempotency_key` required，且唯一範圍是同一 Project、目前 Local Actor、`revoke_result_acceptance` operation。Server 必須先用 closed schema 與語意規則 normalize command：包含 `result_acceptance_id`、trim 後的 `reason`，以及條件式 `next_delivery_status`；`idempotency_key` 本身不參與 command fingerprint。Server 必須使用 RFC 8785 JSON Canonicalization Scheme 對 normalized command 產生 canonical bytes，再用 SHA-256 計算 `normalized_command_hash`，並在成功 transaction 中保存 Operation Receipt。
- Input 不直接包含 `project_id`。Server 必須先以 `result_acceptance_id` 做 identity-only resolution，僅確認 Acceptance identity 存在並解析其 Project scope；此步不得驗證 Acceptance 是否仍有效、Result 是否為 active approved、是否已有 Revocation，或其他 lifecycle／business state。
- 若 `result_acceptance_id` 不存在，identity-only resolution 必須立即回傳 `NOT_FOUND`；server 不得在無法解析 Project scope 時查找或建立 Operation Receipt。
- Operation Receipt lookup 必須先於 Acceptance target state validation。Server 必須先查同一 Project、Local Actor、operation 與 `idempotency_key` 的 receipt；若命中且 normalized command hash 相同，直接 replay，不得因 Result Acceptance 現在已被撤銷、Result 已 archived 或其他由原成功 transaction 造成的狀態變化而回傳 `CONFLICT`。
- 只有 Operation Receipt miss 時，server 才能繼續執行下列完整 Acceptance target state validation。
- 若同一 Project、Local Actor、operation 與 `idempotency_key` 已有 Operation Receipt，且 normalized command hash 相同，tool 必須回放 receipt 中保存的原始成功 response data，不得重新建立 Decision、Result Revocation、archive domain row 或 Ticket status update。
- 若同一 Project、Local Actor、operation 與 `idempotency_key` 已存在但 normalized command hash 不同，必須回傳 `CONFLICT`。不得把既有 Result Revocation uniqueness error 假裝成 idempotent success，也不得覆寫 receipt 或 response。
- 若同一 normalized command 使用不同 `idempotency_key` 重送，必須視為新的 logical command。若該 Result Acceptance 已因先前成功 revocation 而不再有效，或已存在 Result Revocation，必須回傳一般 `CONFLICT`；不得依 `result_acceptance_id` 或既有 Result Revocation 反查 Operation Receipt 並當作 replay。
- 首次成功時建立的 Operation Receipt 必須只綁定本次 Result Revocation：`result_revocation_id` 必須等於新建 Revocation ID，`result_acceptance_id` 必須為 null，且 `operation_name` 必須是 `revoke_result_acceptance`。同一 Result Revocation 最多只能有一筆 Operation Receipt，不得讓不同 idempotency keys 指向同一 Revocation。
- Operation Receipt 只在成功提交 domain transaction 後保存。Validation error、`NOT_FOUND`、`CONFLICT`、`STALE_HANDOFF`、`STORAGE_ERROR` 或其他失敗 response 不得保存；修正失敗原因後，相同 `idempotency_key` 可重新嘗試，除非已有成功 receipt。
- 成功建立 receipt 後，該 Operation Receipt、Result Revocation、其 Result Acceptance 與作為 target identity 的 Implementation Result 都不得 hard delete。Implementation Result 退出有效範圍時只能 archive；Receipt、Acceptance 與 Revocation 沒有 Lifecycle Status，必須永久保留。
- SQLite delete guards 必須無條件拒絕刪除 Operation Receipt、Result Acceptance 與 Result Revocation，並在 Implementation Result 已可經 Acceptance 或 Revocation 連到任一 Receipt 時拒絕刪除該 Result。
- Operation Receipt 的 `response_json` 只保存 successful `ToolResult.data` 的 RFC 8785 canonical JSON UTF-8 text，且不得保存完整 `{ ok, data, error, audit_log_id }` envelope。Replay 時 server 必須 parse 保存的 data 並重新組成目前標準的 `{ ok: true, data, audit_log_id? }`；若原始成功 response 有 `audit_log_id`，該 ID 必須由 receipt 的 audit log reference 重新帶回。
- Replay 必須保持 `data` 完全等同原始成功的 domain response data，不得在 `data` 中新增 `replayed`、`receipt_id`、`idempotency_key` 或其他 replay／receipt marker。
- Replay observability 只能透過 audit log、server log，或未來明確定義的非 domain envelope metadata 表示；不得改變 `ToolResult.data` shape 或內容。
- 若 replay 本身建立 observability log，該 log ID 不得取代 replay response 的 top-level `audit_log_id`。Replay response 的 `audit_log_id` 必須是 receipt 保存的原始成功 domain transaction audit log ID；若原始成功 response 沒有 `audit_log_id`，replay 也不得因 replay observability 產生新的 top-level `audit_log_id`。
- `result_acceptance_id` 必須存在；tool 不接受 `implementation_result_id` 代替或推測要撤銷的 Acceptance。
- Server 必須由 Result Acceptance 反查 Implementation Result、Implementation Target 與 Ticket。Result 必須是 active approved，且該 Acceptance 目前仍有效；Ticket 不需要已是 `done`。
- Result Acceptance 的 `project_id` 必須非空；Result Revocation 與新建 Decision 的 `project_id` 必須由它設定且完全相同。Input 不接受 client-provided `project_id`，也不得建立跨 Project 關係。
- Result Revocation 必須直接引用 input `result_acceptance_id`，不得只保存或接受 Result ID。
- Result Acceptance 不得已有 Result Revocation；每個 Result Acceptance 最多只能撤銷一次。
- `reason` required，trim 後必須非空，且必須說明原 acceptance 為何在作成當時即無效。
- 若 Ticket 目前是 `done`，`next_delivery_status` required，且只能是 `in_progress` 或 `blocked`。
- 若 Ticket 目前是 `planned`、`in_progress` 或 `blocked`，input 必須省略 `next_delivery_status`，操作後保留原 Delivery Status。
- `next_delivery_status` 只是一個條件式 command input，不得原樣作為 Revocation history 欄位。Result Revocation 必須保存操作前的 `previous_delivery_status` 與操作後的 `resulting_delivery_status`；未改變狀態時兩者相同。
- Revocation 必須建立 `decision_type = result_acceptance_revocation` 的 Decision node，以 trim 後的 input `reason` 作為 `Decision.summary`，並以 `Decision.actor_id`、`Decision.created_at` 記錄 Local Actor 與撤銷時間。Result Revocation 只保存 `decision_id`，不得另存或複製 reason、actor 或 time；顯示撤銷資訊時必須讀取 Decision。
- Revocation 不得刪除或改寫原 Result、Acceptance 或 evidence。
- Archive Result、建立 Result Revocation，以及必要時更新 Ticket Delivery Status，必須在單一 transaction 中完成。
- Archived revoked Result 不得重新轉為 draft 或再次接受；任何修正必須透過 `submit_implementation_result` 建立新的 Result。
- 新需求、後續 regression 或原 acceptance criteria 未涵蓋的問題不得使用此操作；應建立具有 `traces_to` 關係的 Follow-up Ticket，原 Ticket 維持 `done`。

### export_markdown_draft

把 active draft 或 approved entity render 成 Markdown。

Input：

```json
{
  "entity_type": "product_brief_version",
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

Product Brief Version 匯出驗收：

- `entity_type = product_brief_version` 時，依指定的 Version ID 讀取 structured data，不能改用 current version。
- 只允許 active draft 或 approved version；不存在回傳 `NOT_FOUND`，archived 回傳 `CONFLICT`，不支援的 entity type 回傳 validation error。
- 必須包含 ProductBriefJson 所有欄位、Version／Project identity 與 review status。空集合明示 `None`，來源中的 Markdown／HTML 視為文字。
- `suggested_filename` 為 `product-brief-{version_id}-v{version_number}.md`，identity 中非英數、底線、連字號字元轉為連字號。
- 匯出不寫入檔案、不修改 structured data、approval 或 audit history。

Ticket Revision 與 Implementation Brief 匯出驗收：

- `entity_type` 另支援 `ticket_revision` 與 `implementation_brief`，直接依指定 artifact ID 讀取。兩者同樣只允許 active draft／approved；不存在回傳 `NOT_FOUND`，archived 回傳 `CONFLICT`。
- Ticket Revision 必須包含該版本的 title、user story、scope、acceptance criterion IDs／文字、non-goals、dependencies、related graph node IDs、follow-up trace、implementation notes，以及所有 required repositories 與 per-revision scopes。保留 Ticket／Project／Revision identities、revision number、base revision、source graph revision、draft batch 與核准來源；歷史 approved revision 不得改用 current revision 或目前 active target membership。
- Implementation Brief 必須包含 implementation plan、suggested files、test strategy、risks、PR summary draft、Review Status、核准來源與 supersedes identity；附上固定引用的 Ticket Revision、Product Brief Version 與 Repository Context Snapshot。Snapshot 包含 repository identity／名稱、summary、files、module notes、baseline commit、dirty state、可核准性及擷取時間，不讀取目前 repository metadata 取代快照。
- 匯出是審查投影，不是 handoff；尚無可驗證 baseline 的 draft 仍可匯出，產品意圖的 current pointer 改變不會改寫或阻擋 active artifact 的固定來源。Implementation Brief 的來源引用不存在或 scope 不一致回傳 `STORAGE_ERROR`。
- 建議檔名為 `ticket-revision-{revision_id}-r{revision_number}.md` 與 `implementation-brief-{brief_id}.md`；identity 字元規則與 Product Brief 相同。
- 空集合明示 `None`、來源 Markdown／HTML 視為文字；不寫入檔案、不修改 canonical data、approval、current pointers 或 audit history。

## External Integration Preparation

### register_external_container

只在本機註冊 Plane 的穩定 External Container identity，供後續明確 export 使用。這個操作不驗證外部連線、不保存 credentials、不建立 External Work Item、mapping、Sync Intent 或 Sync Attempt，也不 enrollment 自動同步。

Input（closed schema）：

```ts
{
  provider: "plane";
  workspace_identity: string;
  container_identity: string;
  display_name?: string;
}
```

Identity fields trim 後必須非空，保留大小寫；`provider` 必須精確為 `plane`。Optional `display_name` 提供時也必須是 trim 後非空的字串，省略時保存 `null`。未知欄位、null 與不支援的 provider 都拒絕，且不產生任何寫入。

Success data：

```ts
{
  external_container: {
    id: string; // ULID
    provider: "plane";
    workspace_identity: string;
    container_identity: string;
    display_name: string | null;
    created_at: string;
    updated_at: string;
  };
  created: boolean;
}
```

- `(provider, workspace_identity, container_identity)` 為全域唯一 identity，不附屬 Project。
- 首次註冊 `created: true`，回傳 `audit_log_id`；container、當前 Local Actor 首次初始化與一筆 `external_container.registered` audit 在同一 transaction 提交。Audit 的 `project_id` 是 `null`，保存 server-configured actor 與時間；失敗全部 rollback。
- 同 identity 重送回傳原 object 與 `created: false`，保留首次 display name、id 與 timestamps，不新增 audit，也不回傳新的 `audit_log_id`。
- 不同 workspace 或不同大小寫的 identity 各自保存。資料於 server 重啟後保留。

### list_external_containers

Input（closed schema）：`{ provider?: "plane" }`。

Success data：`{ external_containers: ExternalContainer[] }`，每項沿用上方 snake_case object。以 `created_at`、`id` 升冪排序，可用 provider filter；空集合回傳 `[]`。這是全域唯讀查詢，不呼叫 provider，也不建立 audit。

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

### Project resources 的讀取契約

所有 resource 回傳 `application/json`，只讀取資料，不建立 audit event 或修改 approval。

- `/projects/{projectId}/brief`：回傳 `{ product_brief, version }`，只呈現 active Product Brief 的 current approved version。尚未核准時兩者都是 `null`；新 draft 不影響既有 approved version。
- `/projects/{projectId}/graph`：回傳 `{ graph_revision_id, nodes, edges }`，與 `get_graph_context` 的預設 active graph 一致。尚未建立 graph 時 revision 為 `null`，nodes／edges 為空陣列。
- `/projects/{projectId}/tickets`：回傳 `{ tickets }`，只列出此 Project 的 active、具有 current approved revision 的 Tickets，依 `created_at`、`id` 排序。尚未核准任何 Ticket 時為空陣列；draft-only 與 archived Tickets 不列入。
- 三個子資源都要求 Project 存在且 active。不存在時 MCP error code 為 `-32002`，error data 的 domain code 為 `NOT_FOUND`；Project archived 時為 `-32602`／`CONFLICT`。不把缺失的 Project 當作空集合。
- 既有 `/projects` 與 `/projects/{projectId}` summary resources 保留原有行為。

### Ticket 與 Node resources 的讀取契約

- `/tickets/{ticketId}` 回傳 `{ ticket }`；`/nodes/{nodeId}` 回傳 `{ node }`。明確以 ID 讀取 identity 可包含 draft-only Ticket 或 archived entity，保留其 lifecycle status，方便查閱歷史。
- `/tickets/{ticketId}/context` 與 `get_ticket_context` 預設相同，回傳 `{ ticket, revision, related_nodes, related_edges, traced_ticket, trace_edge, markdown: null }`。要求 active Ticket 與有效的 current approved revision；尚未核准或 archived Ticket 回傳 `CONFLICT`。related nodes 是該 revision 的明確引用，可能包含後來 archived 的歷史來源，且只包含相同 Project；related edges 只包含 active 關係。
- `/nodes/{nodeId}/trace` 等同 `get_node_trace` 的 `direction = both`、`max_depth = 3`，包含上述 active graph 與 archived root 語意。
- 四個 resource 都使用 `application/json` 且不修改資料。不存在的 identity 使用 MCP `-32002`／domain `NOT_FOUND`；狀態衝突使用 `-32602`／`CONFLICT`。可由明確 identity 查閱 archived Project 內的資料，不將 Project lifecycle 當作身份讀取權限。

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

| Prompt | 必填字串 arguments | 輸出用途 |
| --- | --- | --- |
| `product-brief` | `project_id`, `source_idea_id` | `create_product_brief_draft` arguments |
| `extract-graph` | `project_id` | `create_graph_draft_batch` arguments |
| `generate-tickets` | `project_id` | `create_ticket_draft_batch` arguments |
| `implementation-brief` | `ticket_id`, `implementation_target_id` | `create_implementation_brief_draft` arguments |
| `review-ticket-quality` | `ticket_id` | 唯讀品質 findings 與 open questions |
| `trace-feature-context` | `project_id`, `node_id` | 唯讀 paths、source references 與 gaps |

Arguments 經 trim 後不得為空。`prompts/get` 只回傳 client-side instructions 與工具呼叫 JSON 範例，不讀寫 domain 資料、不執行 generation，也不呼叫 provider。Client 先讀 `tools/list` 的實際 schema，並取得來源與精確版本，才填寫 JSON。範例中的 `<...>` 不是可提交的 identities；缺少介面或來源資料時停止相關生成並取得 structured context。

所有生成均先建立 draft；使用者對該 draft identity 的明確核准才可觸發 approval tools。唯讀 review／trace 不執行 mutations，review 通過不構成 Approval。Prompt 不替代 tools 的資料驗證、來源 freshness 與 optimistic concurrency checks。

## Sync Intent Read Tools

### `get_sync_intent`

Input：`{ "sync_intent_id": "<Sync Intent ID>" }`。

Output data：

```json
{
  "sync_intent": {
    "id": "intent-id",
    "project_id": "project-id",
    "mapping_id": null,
    "external_container_id": "container-id",
    "sequence_number": null,
    "operation": "create",
    "source_event_type": "plane_ticket_export_requested",
    "source_event_id": "original-audit-id",
    "source_ticket_revision_id": "approved-revision-id",
    "payload_hash": "sha256",
    "payload": {
      "schema_version": 1,
      "owner": { "type": "ticket", "id": "ticket-id" },
      "source_ticket_revision_id": "approved-revision-id",
      "specification": { "title": "Pinned title" }
    },
    "idempotency_key": "stable-logical-operation-key",
    "supersedes_sync_intent_id": null,
    "lifecycle_status": "active",
    "created_at": "2026-09-27T00:00:00.000Z"
  },
  "attempts": [],
  "request_state": "pending"
}
```

`payload` 是原始持久化 JSON 的解析結果；上例省略其 specification 的其他欄位。讀取不得從 Ticket 的最新 title、revision 或其他 mutable state 重新產生 payload。Container identity 以 intent 的 `external_container_id` 回傳；metadata 由 External Container list 工具另行查詢。

`attempts` 包含全部歷史，依 `started_at`、`id` 升冪排序。每個 attempt 回傳 `id`、`sync_intent_id`、`external_work_item_id`、`operation`、`idempotency_key`、`started_at`、`completed_at`、`result_status`、解析後的 `response` 與 `error`；可空欄位保留 `null`。

單一 request 的 `request_state` 依序判定：

1. Intent 已 archive：`archived`。
2. 任一 attempt 成功：`succeeded`，晚到的 failure 不覆蓋成功。
3. 無成功 attempt 時，最新 attempt 是 `started`：`running`；是 `failed`：`failed`。
4. 尚無 attempt：`pending`。

這是單一 request 的狀態，不是 owner／mapping 的 Sync Health，不回傳 `current`。Unknown intent 回傳 `NOT_FOUND`。Archived intent 仍可查詢。

### `list_ticket_export_requests`

Input：`{ "ticket_id": "<Ticket ID>" }`。Output data：`{ "requests": [] }`；每個 request 與 `get_sync_intent` 的 data 結構相同。

只列出 `source_event_type = plane_ticket_export_requested` 且 `operation = create` 的 intents。Ownership 由 `source_ticket_revision_id → Ticket Revision → Ticket` 確认，intent、revision 與 Ticket 的 Project 必須一致；pinned payload 的 `owner.type = ticket`、`owner.id` 與 source revision 也必須相符。其他 owner、Project、event 或 operation 的資料不得混入。

Requests 依 `created_at`、`id` 升冪排序，包含 archived intents／Ticket／revision 的歷史。Existing Ticket 尚無 request 回傳空陣列；unknown Ticket 回傳 `NOT_FOUND`。

兩個工具皆只讀，不新增 audit、不變更 domain state、不啟動 processor 或呼叫 provider。重啟後應得到相同的 pinned request 與完整 attempts；查詢成功不表示外部 work item 已建立。
