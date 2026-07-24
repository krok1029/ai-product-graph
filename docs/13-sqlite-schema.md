# SQLite Schema

## 設計原則

- SQLite 是第一版 canonical storage。
- SQLite driver 使用 `better-sqlite3`。
- 預設 database path 是 `./data/ai-product-graph.sqlite`。
- 可用 `AI_PRODUCT_GRAPH_DB_PATH` 覆蓋 database path。
- 主要 ID 使用 ULID。
- 主要 entities 保留 `slug`，供顯示、搜尋和外部匯出。
- AI generated content 一律先 `draft`。
- Product Brief canonical content 使用 JSON。
- Markdown 是 rendering output，不是 source of truth。
- Graph edits 寫入 `audit_log`。
- 第一版預留 embedding extension point，但不實作 vector search。

## Common Columns

主要資料表盡量包含：

```text
id
project_id
slug
status
metadata_json
created_at
updated_at
approved_at
archived_at
```

時間格式使用 ISO 8601 UTC string。

## Tables

### projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
```

### ideas

```sql
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Indexes：

```sql
CREATE INDEX idx_ideas_project_id ON ideas(project_id);
CREATE UNIQUE INDEX idx_ideas_project_slug ON ideas(project_id, slug);
```

### product_briefs

```sql
CREATE TABLE product_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_idea_id TEXT,
  slug TEXT NOT NULL,
  status TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (source_idea_id) REFERENCES ideas(id)
);
```

Indexes：

```sql
CREATE INDEX idx_product_briefs_project_id ON product_briefs(project_id);
CREATE INDEX idx_product_briefs_status ON product_briefs(status);
CREATE UNIQUE INDEX idx_product_briefs_project_slug ON product_briefs(project_id, slug);
```

### graph_nodes

```sql
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL,
  source_ref_type TEXT,
  source_ref_id TEXT,
  external_ref TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Indexes：

```sql
CREATE INDEX idx_graph_nodes_project_id ON graph_nodes(project_id);
CREATE INDEX idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX idx_graph_nodes_status ON graph_nodes(status);
CREATE UNIQUE INDEX idx_graph_nodes_project_slug ON graph_nodes(project_id, slug);
```

### graph_edges

```sql
CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (source_node_id) REFERENCES graph_nodes(id),
  FOREIGN KEY (target_node_id) REFERENCES graph_nodes(id)
);
```

Indexes：

```sql
CREATE INDEX idx_graph_edges_project_id ON graph_edges(project_id);
CREATE INDEX idx_graph_edges_source_node_id ON graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target_node_id ON graph_edges(target_node_id);
CREATE INDEX idx_graph_edges_relation_type ON graph_edges(relation_type);
CREATE INDEX idx_graph_edges_status ON graph_edges(status);
```

### tickets

```sql
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  user_story TEXT,
  scope_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  non_goals_json TEXT NOT NULL DEFAULT '[]',
  implementation_notes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  workflow_status TEXT NOT NULL DEFAULT 'backlog',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Indexes：

```sql
CREATE INDEX idx_tickets_project_id ON tickets(project_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_workflow_status ON tickets(workflow_status);
CREATE UNIQUE INDEX idx_tickets_project_slug ON tickets(project_id, slug);
```

### ticket_graph_nodes

Join table for ticket-to-graph traceability。

```sql
CREATE TABLE ticket_graph_nodes (
  ticket_id TEXT NOT NULL,
  graph_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ticket_id, graph_node_id, relation_type),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (graph_node_id) REFERENCES graph_nodes(id)
);
```

Indexes：

```sql
CREATE INDEX idx_ticket_graph_nodes_node_id ON ticket_graph_nodes(graph_node_id);
```

### implementation_briefs

```sql
CREATE TABLE implementation_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL,
  repo_context_json TEXT NOT NULL DEFAULT '{}',
  brief_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);
```

Indexes：

```sql
CREATE INDEX idx_implementation_briefs_project_id ON implementation_briefs(project_id);
CREATE INDEX idx_implementation_briefs_ticket_id ON implementation_briefs(ticket_id);
CREATE UNIQUE INDEX idx_implementation_briefs_project_slug ON implementation_briefs(project_id, slug);
```

### external_links

External links are adapter-owned references, not domain source of truth。

```sql
CREATE TABLE external_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT,
  external_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Indexes：

```sql
CREATE INDEX idx_external_links_project_id ON external_links(project_id);
CREATE INDEX idx_external_links_entity ON external_links(entity_type, entity_id);
CREATE INDEX idx_external_links_provider ON external_links(provider);
```

### audit_log

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_summary_json TEXT,
  after_summary_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

Indexes：

```sql
CREATE INDEX idx_audit_log_project_id ON audit_log(project_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
```

## Enum Values

### Entity Status

```text
draft
approved
archived
```

### Ticket Workflow Status

```text
backlog
ready
in_progress
blocked
done
cancelled
```

### Graph Node Types

```text
idea
product_goal
persona
pain_point
workflow
feature_area
epic
ticket
acceptance_criterion
decision
repository
code_file
pull_request
test_case
release
feedback
```

### Graph Edge Types

```text
clarifies
supports
solves
belongs_to
depends_on
implements
validated_by
changed_by
traces_to
blocked_by
```

## Migration Strategy

第一版可以使用簡單 migration runner：

```text
src/infrastructure/migrations/001_initial_schema.sql
src/infrastructure/migrations/002_add_indexes.sql
```

Phase 1A 直接建立完整 schema，不只建立 `projects` / `ideas` / `audit_log`。但第一批 repository 和 use cases 只實作 projects / ideas / audit log。

需要一張 migration tracking table：

```sql
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

## Validation Rules

- 所有 JSON 欄位寫入前必須 stringify 並 schema validate。
- `status` 必須符合 enum。
- Approved ticket 必須至少有一個 acceptance criterion。
- Approved ticket 必須至少連到一個 graph node。
- Graph edge 的 source / target node 必須屬於同一 project。
- External links 不應改變 canonical domain state。
