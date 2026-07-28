# SQLite Schema

## 設計原則

- SQLite 是 Phase 1A 的 canonical storage。
- SQLite driver 使用 `better-sqlite3`。
- 每個 SQLite connection 在交給 migration、repository 或 transaction 使用前，都必須執行 `PRAGMA foreign_keys = ON` 並讀回確認值為 `1`；無法啟用或驗證時不得使用該 connection。
- 預設 database path 是 `./data/ai-product-graph.sqlite`。
- 可用 `AI_PRODUCT_GRAPH_DB_PATH` 覆蓋 database path。
- 主要 ID 使用 ULID。
- 時間格式使用 ISO 8601 UTC string。
- Markdown 是 rendering output，不是 source of truth。
- Product Brief、Ticket、Implementation Brief、Implementation Result 等正式內容使用 structured JSON 保存。
- Review Status 與 Lifecycle Status 分開保存：`review_status` 只用於需要人類審查的 content artifact；`lifecycle_status` 表示是否仍在目前有效範圍。
- Approval 必須透過 base pointer 或 source revision 做 optimistic concurrency check。
- Graph reconciliation 只能透過 approved Graph Draft Batch 建立 Graph Revision；no-op reconciliation 也建立 Graph Revision。
- 外部同步使用 durable Sync Intents / Sync Attempts，不在 internal transaction 內呼叫外部 API。
- 第一版預留 embedding extension point，但不實作 vector search。

## Common Columns

常見欄位：

```text
id
project_id
slug
metadata_json
created_at
updated_at
approved_at
archived_at
```

狀態欄位命名：

```text
review_status    -- draft / approved，只存在於需要人類審查的版本或候選 artifact
lifecycle_status -- active / archived，存在於 canonical entities 與 content artifacts
delivery_status  -- planned / in_progress / blocked / done，只存在於 Ticket
```

## Connection Initialization

`foreign_keys` 是 per-connection setting，不能只在 migration connection 設定。Connection factory 必須對每個新 connection 執行：

```sql
PRAGMA foreign_keys = ON;
```

接著讀取 `PRAGMA foreign_keys`。只有回傳 `1` 時才能把 connection 交給 migration runner、repositories 或 use case transactions；設定或 read-back 失敗時必須關閉該 connection，並讓 server startup／connection acquisition 失敗。

## Tables

### schema_migrations

```sql
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

### local_actors

```sql
CREATE TABLE local_actors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
```

### projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  lifecycle_status TEXT NOT NULL,
  current_product_brief_id TEXT,
  current_graph_revision_id TEXT,
  last_reconciled_product_brief_version_id TEXT,
  product_intent_graph_revision_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (current_product_brief_id) REFERENCES product_briefs(id),
  FOREIGN KEY (current_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (last_reconciled_product_brief_version_id) REFERENCES product_brief_versions(id),
  FOREIGN KEY (product_intent_graph_revision_id) REFERENCES graph_revisions(id)
);
```

Notes：

- Product Intent Reconciliation 由 current Product Brief 的 `current_approved_version_id` 與 `last_reconciled_product_brief_version_id` 衍生。
- `product_intent_graph_revision_id` 指向完成 product-intent reconciliation 的 Graph Revision。

### repositories

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  root_path TEXT,
  remote_url TEXT,
  lifecycle_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Indexes：

```sql
CREATE INDEX idx_repositories_project_id ON repositories(project_id);
CREATE UNIQUE INDEX idx_repositories_project_slug ON repositories(project_id, slug);
```

### ideas

```sql
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Notes：

- Idea Record 是 immutable raw source record；沒有 `review_status`。
- AI 改寫或補充應建立 draft interpretation，不得覆蓋 raw idea。

Indexes：

```sql
CREATE INDEX idx_ideas_project_id ON ideas(project_id);
CREATE UNIQUE INDEX idx_ideas_project_slug ON ideas(project_id, slug);
```

### feedback_records

```sql
CREATE TABLE feedback_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

### product_briefs

```sql
CREATE TABLE product_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_idea_id TEXT,
  slug TEXT NOT NULL,
  current_approved_version_id TEXT,
  lifecycle_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (source_idea_id) REFERENCES ideas(id),
  FOREIGN KEY (current_approved_version_id) REFERENCES product_brief_versions(id)
);
```

Indexes：

```sql
CREATE INDEX idx_product_briefs_project_id ON product_briefs(project_id);
CREATE UNIQUE INDEX idx_product_briefs_project_slug ON product_briefs(project_id, slug);
```

### product_brief_versions

```sql
CREATE TABLE product_brief_versions (
  id TEXT PRIMARY KEY,
  product_brief_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  base_approved_version_id TEXT,
  brief_json TEXT NOT NULL,
  review_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  approved_by_actor_id TEXT,
  approved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (product_brief_id) REFERENCES product_briefs(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (base_approved_version_id) REFERENCES product_brief_versions(id),
  FOREIGN KEY (approved_by_actor_id) REFERENCES local_actors(id)
);
```

Indexes：

```sql
CREATE INDEX idx_product_brief_versions_project_id ON product_brief_versions(project_id);
CREATE INDEX idx_product_brief_versions_brief_id ON product_brief_versions(product_brief_id);
CREATE UNIQUE INDEX idx_product_brief_versions_number ON product_brief_versions(product_brief_id, version_number);
```

### graph_draft_batches

```sql
CREATE TABLE graph_draft_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_product_brief_version_id TEXT NOT NULL,
  base_graph_revision_id TEXT,
  reconciliation_summary TEXT,
  review_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  approved_by_actor_id TEXT,
  approved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (source_product_brief_version_id) REFERENCES product_brief_versions(id),
  FOREIGN KEY (base_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (approved_by_actor_id) REFERENCES local_actors(id)
);
```

Notes：

- `reconciliation_summary` is required when the batch has no changes.
- `review_status` belongs to the batch, not to individual proposed changes.

### graph_draft_batch_changes

```sql
CREATE TABLE graph_draft_batch_changes (
  id TEXT PRIMARY KEY,
  graph_draft_batch_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  target_id TEXT,
  payload_json TEXT NOT NULL,
  conflict_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (graph_draft_batch_id) REFERENCES graph_draft_batches(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Indexes：

```sql
CREATE INDEX idx_graph_draft_batch_changes_batch_id ON graph_draft_batch_changes(graph_draft_batch_id);
CREATE UNIQUE INDEX idx_graph_draft_batch_changes_change_id ON graph_draft_batch_changes(graph_draft_batch_id, change_id);
```

### graph_revisions

```sql
CREATE TABLE graph_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  graph_draft_batch_id TEXT NOT NULL,
  source_product_brief_version_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  is_noop_reconciliation INTEGER NOT NULL DEFAULT 0,
  reconciliation_summary TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (graph_draft_batch_id) REFERENCES graph_draft_batches(id),
  FOREIGN KEY (source_product_brief_version_id) REFERENCES product_brief_versions(id)
);
```

Indexes：

```sql
CREATE UNIQUE INDEX idx_graph_revisions_project_sequence ON graph_revisions(project_id, sequence_number);
CREATE INDEX idx_graph_revisions_source_version ON graph_revisions(source_product_brief_version_id);
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
  lifecycle_status TEXT NOT NULL,
  created_in_graph_revision_id TEXT NOT NULL,
  last_changed_in_graph_revision_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_in_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (last_changed_in_graph_revision_id) REFERENCES graph_revisions(id)
);
```

Indexes：

```sql
CREATE INDEX idx_graph_nodes_project_id ON graph_nodes(project_id);
CREATE INDEX idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX idx_graph_nodes_lifecycle_status ON graph_nodes(lifecycle_status);
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
  lifecycle_status TEXT NOT NULL,
  created_in_graph_revision_id TEXT NOT NULL,
  last_changed_in_graph_revision_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (source_node_id) REFERENCES graph_nodes(id),
  FOREIGN KEY (target_node_id) REFERENCES graph_nodes(id),
  FOREIGN KEY (created_in_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (last_changed_in_graph_revision_id) REFERENCES graph_revisions(id)
);
```

Indexes：

```sql
CREATE INDEX idx_graph_edges_project_id ON graph_edges(project_id);
CREATE INDEX idx_graph_edges_source_node_id ON graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target_node_id ON graph_edges(target_node_id);
CREATE INDEX idx_graph_edges_relation_type ON graph_edges(relation_type);
CREATE INDEX idx_graph_edges_lifecycle_status ON graph_edges(lifecycle_status);
```

### ticket_draft_batches

```sql
CREATE TABLE ticket_draft_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_graph_revision_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (source_graph_revision_id) REFERENCES graph_revisions(id)
);
```

### tickets

```sql
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  current_approved_revision_id TEXT,
  lifecycle_status TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (current_approved_revision_id) REFERENCES ticket_revisions(id)
);
```

Indexes：

```sql
CREATE INDEX idx_tickets_project_id ON tickets(project_id);
CREATE INDEX idx_tickets_lifecycle_status ON tickets(lifecycle_status);
CREATE INDEX idx_tickets_delivery_status ON tickets(delivery_status);
CREATE UNIQUE INDEX idx_tickets_project_slug ON tickets(project_id, slug);
```

### ticket_revisions

```sql
CREATE TABLE ticket_revisions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  ticket_draft_batch_id TEXT,
  revision_number INTEGER NOT NULL,
  base_approved_revision_id TEXT,
  source_graph_revision_id TEXT NOT NULL,
  title TEXT NOT NULL,
  specification_json TEXT NOT NULL,
  required_targets_json TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  approved_by_actor_id TEXT,
  approved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (ticket_draft_batch_id) REFERENCES ticket_draft_batches(id),
  FOREIGN KEY (base_approved_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (source_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (approved_by_actor_id) REFERENCES local_actors(id)
);
```

Indexes：

```sql
CREATE INDEX idx_ticket_revisions_project_id ON ticket_revisions(project_id);
CREATE INDEX idx_ticket_revisions_ticket_id ON ticket_revisions(ticket_id);
CREATE UNIQUE INDEX idx_ticket_revisions_number ON ticket_revisions(ticket_id, revision_number);
```

### ticket_revision_graph_nodes

```sql
CREATE TABLE ticket_revision_graph_nodes (
  ticket_revision_id TEXT NOT NULL,
  graph_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ticket_revision_id, graph_node_id, relation_type),
  FOREIGN KEY (ticket_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (graph_node_id) REFERENCES graph_nodes(id)
);
```

### ticket_revision_dependencies

```sql
CREATE TABLE ticket_revision_dependencies (
  ticket_revision_id TEXT NOT NULL,
  depends_on_ticket_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ticket_revision_id, depends_on_ticket_id),
  FOREIGN KEY (ticket_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (depends_on_ticket_id) REFERENCES tickets(id)
);
```

### implementation_targets

```sql
CREATE TABLE implementation_targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id)
);
```

Indexes：

```sql
CREATE INDEX idx_implementation_targets_project_id ON implementation_targets(project_id);
CREATE INDEX idx_implementation_targets_ticket_id ON implementation_targets(ticket_id);
CREATE UNIQUE INDEX idx_implementation_targets_active_ticket_repository
  ON implementation_targets(ticket_id, repository_id)
  WHERE lifecycle_status = 'active';
```

### repository_context_snapshots

```sql
CREATE TABLE repository_context_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  baseline_commit_sha TEXT,
  dirty_state_fingerprint TEXT,
  context_json TEXT NOT NULL,
  is_approvable INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id)
);
```

### implementation_briefs

```sql
CREATE TABLE implementation_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  implementation_target_id TEXT NOT NULL,
  ticket_revision_id TEXT NOT NULL,
  product_brief_version_id TEXT NOT NULL,
  repository_context_snapshot_id TEXT NOT NULL,
  supersedes_implementation_brief_id TEXT,
  slug TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  review_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  approved_by_actor_id TEXT,
  approved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (implementation_target_id) REFERENCES implementation_targets(id),
  FOREIGN KEY (ticket_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (product_brief_version_id) REFERENCES product_brief_versions(id),
  FOREIGN KEY (repository_context_snapshot_id) REFERENCES repository_context_snapshots(id),
  FOREIGN KEY (supersedes_implementation_brief_id) REFERENCES implementation_briefs(id),
  FOREIGN KEY (approved_by_actor_id) REFERENCES local_actors(id)
);
```

Indexes：

```sql
CREATE INDEX idx_implementation_briefs_target_id ON implementation_briefs(implementation_target_id);
CREATE INDEX idx_implementation_briefs_ticket_revision_id ON implementation_briefs(ticket_revision_id);
CREATE UNIQUE INDEX idx_implementation_briefs_active_approved_target
  ON implementation_briefs(implementation_target_id)
  WHERE review_status = 'approved' AND lifecycle_status = 'active';
```

### observed_evidence

```sql
CREATE TABLE observed_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id)
);
```

Notes：

- Observed Evidence is repository-scoped and intentionally has no `implementation_target_id`.
- Implementation Target binding is represented by `implementation_results` and `implementation_result_evidence`.
- `implementation_result_evidence` is many-to-many: the same Observed Evidence may be referenced by multiple Implementation Results when each Result target belongs to the evidence Repository. Criterion verdicts and Result Acceptance remain specific to each Result and are not inherited through evidence reuse.
- The server applies schema-defined semantic normalization before RFC 8785 JSON canonicalization. `payload_hash` is SHA-256 over the resulting canonical UTF-8 bytes; input must not trust a client-provided hash.
- `payload_json` stores the exact RFC 8785 canonical JSON UTF-8 text that was hashed. Phase 1A does not retain the client's original payload representation.
- Idempotency is project-scoped, not repository-scoped; repeated ingestion with the same `(project_id, idempotency_key)` returns the existing row only when `repository_id`, `evidence_type`, and `payload_hash` all match the existing row.
- Reusing an existing `(project_id, idempotency_key)` with a different `repository_id`, `evidence_type`, or `payload_hash` is a conflict.

Indexes：

```sql
CREATE INDEX idx_observed_evidence_project_id ON observed_evidence(project_id);
CREATE INDEX idx_observed_evidence_repository_id ON observed_evidence(repository_id);
CREATE INDEX idx_observed_evidence_type ON observed_evidence(evidence_type);
CREATE INDEX idx_observed_evidence_payload_hash ON observed_evidence(payload_hash);
CREATE UNIQUE INDEX idx_observed_evidence_project_idempotency_key
  ON observed_evidence(project_id, idempotency_key);
```

### implementation_results

```sql
CREATE TABLE implementation_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  implementation_brief_id TEXT NOT NULL,
  implementation_target_id TEXT NOT NULL,
  ticket_revision_id TEXT NOT NULL,
  supersedes_implementation_result_id TEXT,
  result_json TEXT NOT NULL,
  review_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  stale_at_submission INTEGER NOT NULL DEFAULT 0,
  stale_reasons_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (implementation_brief_id) REFERENCES implementation_briefs(id),
  FOREIGN KEY (implementation_target_id) REFERENCES implementation_targets(id),
  FOREIGN KEY (ticket_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (supersedes_implementation_result_id) REFERENCES implementation_results(id)
);
```

Indexes：

```sql
CREATE INDEX idx_implementation_results_target_id ON implementation_results(implementation_target_id);
CREATE INDEX idx_implementation_results_ticket_revision_id ON implementation_results(ticket_revision_id);
CREATE UNIQUE INDEX idx_implementation_results_active_approved_target
  ON implementation_results(implementation_target_id)
  WHERE review_status = 'approved' AND lifecycle_status = 'active';
```

### implementation_result_evidence

```sql
CREATE TABLE implementation_result_evidence (
  implementation_result_id TEXT NOT NULL,
  observed_evidence_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (implementation_result_id, observed_evidence_id),
  FOREIGN KEY (implementation_result_id) REFERENCES implementation_results(id),
  FOREIGN KEY (observed_evidence_id) REFERENCES observed_evidence(id)
);
```

Notes：

- Rows for an `implementation_result_id` define that Result's complete Observed Evidence set.
- Every evidence ID stored in that Result's `acceptance_criterion_verdicts.evidence_ids_json` must also have a matching `implementation_result_evidence` row.
- An `implementation_result_evidence` row need not appear in any criterion verdict. Unreferenced Result evidence may support the summary, unfinished items, or implementation provenance, but it contributes nothing to criterion satisfaction or Result Acceptance.

### acceptance_criterion_verdicts

```sql
CREATE TABLE acceptance_criterion_verdicts (
  id TEXT PRIMARY KEY,
  implementation_result_id TEXT NOT NULL,
  acceptance_criterion_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (implementation_result_id) REFERENCES implementation_results(id)
);
```

Notes：

- A `satisfied` row requires a `reason` that remains non-empty after trimming and explains how its evidence supports the criterion. It may be stored as a draft with an empty `evidence_ids_json` while awaiting correction, but the Result is not eligible for acceptance.
- At Result Acceptance, every `satisfied` row must have a valid reason and reference at least one Observed Evidence ID from the same Result's `implementation_result_evidence` set.
- An `unsatisfied` row requires a `reason` that remains non-empty after trimming. It may use an empty `evidence_ids_json` or reference contrary evidence such as a failed test; either form makes the Result ineligible for acceptance unless `accept_implementation_result` receives a waiver input for the same criterion.
- `submit_implementation_result` may only create `satisfied` or `unsatisfied` rows; it must reject `waived`, client-provided `waiver_decision_id`, or any waiver decision payload.
- Rows are immutable submission facts. Result Acceptance must not change `verdict`, `reason`, or `evidence_ids_json`; final acceptance disposition is stored separately in `result_acceptance_criterion_outcomes`.

### result_acceptances

```sql
CREATE TABLE result_acceptances (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  implementation_result_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (implementation_result_id) REFERENCES implementation_results(id),
  FOREIGN KEY (actor_id) REFERENCES local_actors(id)
);

CREATE UNIQUE INDEX idx_result_acceptances_implementation_result
  ON result_acceptances(implementation_result_id);
```

Notes：

- Each Implementation Result may have at most one Result Acceptance, including after that Acceptance is revoked.
- `actor_id` and `accepted_at` are the sole authoritative acceptance actor and time. `implementation_results` must not duplicate them as approval fields.
- The application must derive `actor_id` from the current Local Actor. At the start of the transaction it must capture one event time and reuse it for `accepted_at`, every Outcome `created_at`, and every Waiver Decision `created_at`. `accept_implementation_result` must reject client-provided acceptance actor or time fields rather than ignore them.
- `accept_implementation_result` requires a client-provided idempotency key and must persist an Operation Receipt in the same transaction as the Acceptance, Outcomes, Waiver Decisions, archived Results, and Ticket status update.

### operation_receipts

```sql
CREATE TABLE operation_receipts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  local_actor_id TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  normalized_command_hash TEXT NOT NULL,
  normalized_command_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_audit_log_id TEXT,
  result_acceptance_id TEXT,
  result_revocation_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (local_actor_id) REFERENCES local_actors(id),
  FOREIGN KEY (response_audit_log_id) REFERENCES audit_log(id),
  FOREIGN KEY (result_acceptance_id) REFERENCES result_acceptances(id),
  FOREIGN KEY (result_revocation_id) REFERENCES result_revocations(id),
  CHECK (
    (
      operation_name = 'accept_implementation_result'
      AND result_acceptance_id IS NOT NULL
      AND result_revocation_id IS NULL
    )
    OR (
      operation_name = 'revoke_result_acceptance'
      AND result_acceptance_id IS NULL
      AND result_revocation_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX idx_operation_receipts_project_actor_operation_key
  ON operation_receipts(project_id, local_actor_id, operation_name, idempotency_key);

CREATE INDEX idx_operation_receipts_result_acceptance_id
  ON operation_receipts(result_acceptance_id);

CREATE INDEX idx_operation_receipts_result_revocation_id
  ON operation_receipts(result_revocation_id);

CREATE UNIQUE INDEX idx_operation_receipts_unique_result_acceptance
  ON operation_receipts(result_acceptance_id)
  WHERE result_acceptance_id IS NOT NULL;

CREATE UNIQUE INDEX idx_operation_receipts_unique_result_revocation
  ON operation_receipts(result_revocation_id)
  WHERE result_revocation_id IS NOT NULL;

CREATE INDEX idx_operation_receipts_response_audit_log_id
  ON operation_receipts(response_audit_log_id);
```

Notes：

- Phase 1A uses Operation Receipts for `accept_implementation_result` and `revoke_result_acceptance`; future mutating commands may reuse the same table only after their command normalization and replay response contracts are defined.
- Phase 1A receipts must bind to exactly one domain event: `accept_implementation_result` receipts set `result_acceptance_id` and leave `result_revocation_id` null; `revoke_result_acceptance` receipts set `result_revocation_id` and leave `result_acceptance_id` null. The application must keep `operation_name` consistent with the populated event FK.
- Each Result Acceptance and each Result Revocation may be referenced by at most one Operation Receipt. The partial unique indexes prevent multiple idempotency keys from pointing at the same domain event.
- The receipt's uniqueness scope is Project + Local Actor + operation name + idempotency key. A key reused by another Local Actor is a separate operation because acceptance actor is server-derived.
- Acceptance and revocation inputs do not carry `project_id`. Before receipt lookup, the application performs identity-only resolution from `implementation_result_id` or `result_acceptance_id` to the target's Project. This step checks only identity existence and Project scope; it must not validate lifecycle, current state, prior Acceptance or Revocation, or other business eligibility.
- If identity-only resolution cannot find the target, the command returns `NOT_FOUND` immediately. Without a Project scope, it must not look up or create an Operation Receipt.
- Receipt lookup must happen before target state validation. A matching receipt with the same normalized command hash is replayed even when the target Result or Acceptance is no longer executable because of the original successful transaction.
- Full target state validation runs only after receipt lookup misses.
- An Operation Receipt and every Result Acceptance, Result Revocation, and Implementation Result on its replay path must not be hard-deleted. An Implementation Result may leave the active domain only through `lifecycle_status = 'archived'`; receipts, Acceptances, and Revocations have no Lifecycle Status and are retained permanently.
- Different idempotency keys are different logical commands even when their normalized command hashes are identical. If a different key targets a Result or Acceptance already changed by a previous successful command, the tool returns a normal `CONFLICT`; it must not discover the existing domain event and treat it as replay.
- For `accept_implementation_result`, `normalized_command_json` contains the schema-normalized command without the `idempotency_key`: `implementation_result_id` and trimmed waiver reasons ordered by the approved Ticket Revision's `acceptance_criteria` array. The server must apply RFC 8785 JSON Canonicalization Scheme to that normalized command, store the resulting canonical JSON UTF-8 text in `normalized_command_json`, and compute `normalized_command_hash` as SHA-256 over those canonical bytes.
- For `revoke_result_acceptance`, `normalized_command_json` contains the schema-normalized command without the `idempotency_key`: `result_acceptance_id`, trimmed `reason`, and the conditional `next_delivery_status` field only when it is validly required. The server must apply RFC 8785 JSON Canonicalization Scheme to that normalized command, store the resulting canonical JSON UTF-8 text in `normalized_command_json`, and compute `normalized_command_hash` as SHA-256 over those canonical bytes.
- Repeating the same key with the same normalized command hash returns `response_json`, the original successful `ToolResult.data`, and must not create new domain rows or reapply Ticket status changes. The server rewraps it as the current standard `{ ok: true, data, audit_log_id? }` envelope.
- Repeating the same key with a different normalized command hash returns `CONFLICT`; the existing receipt and all domain rows remain unchanged.
- Operation Receipts are written only after the domain transaction succeeds. Validation errors, `NOT_FOUND`, `CONFLICT`, `STALE_HANDOFF`, `STORAGE_ERROR`, and other failed responses are not persisted or replayed.
- `response_json` stores only the exact successful `ToolResult.data` shape needed for replay as RFC 8785 canonical JSON UTF-8 text, not the full `{ ok, data, error, audit_log_id }` envelope. For `accept_implementation_result`, it includes `implementation_result`, `result_acceptance`, ordered `criterion_outcomes`, ordered `waiver_decisions`, `archived_result_ids`, and `ticket`. For `revoke_result_acceptance`, it includes `implementation_result`, `result_revocation`, `decision`, and `ticket`.
- If the original successful ToolResult included `audit_log_id`, `response_audit_log_id` stores that original domain transaction audit log ID so replay can rewrap the saved data with the same top-level audit log reference.
- Replay must keep `data` byte-for-byte equivalent to the stored successful domain response after JSON parsing. It must not add `replayed`, `receipt_id`, `idempotency_key`, or any other replay marker inside `data`.
- Replay observability may be recorded through audit log, server log, or future explicitly defined non-domain envelope metadata only. It must not change `ToolResult.data`.
- A replay observability log ID must not replace the replay response's top-level `audit_log_id`. If `response_audit_log_id` is non-null, replay returns that ID; if it is null, replay returns no top-level `audit_log_id` even when replay observability is recorded elsewhere.

### result_acceptance_criterion_outcomes

```sql
CREATE TABLE result_acceptance_criterion_outcomes (
  id TEXT PRIMARY KEY,
  result_acceptance_id TEXT NOT NULL,
  acceptance_criterion_id TEXT NOT NULL,
  submitted_verdict_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  waiver_decision_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (result_acceptance_id) REFERENCES result_acceptances(id),
  FOREIGN KEY (submitted_verdict_id) REFERENCES acceptance_criterion_verdicts(id),
  FOREIGN KEY (waiver_decision_id) REFERENCES decisions(id)
);

CREATE UNIQUE INDEX idx_result_acceptance_criterion_outcomes_criterion
  ON result_acceptance_criterion_outcomes(result_acceptance_id, acceptance_criterion_id);
```

Notes：

- Every acceptance criterion for the accepted Result must have exactly one outcome in that Result Acceptance.
- Every Outcome's `created_at` must equal its Result Acceptance's `accepted_at`.
- `accept_implementation_result` must return every Outcome's complete canonical row: `id`, `result_acceptance_id`, `acceptance_criterion_id`, `submitted_verdict_id`, `outcome`, `waiver_decision_id`, and `created_at`. A `satisfied` Outcome returns `waiver_decision_id: null` rather than omitting the field.
- Response Outcomes follow the original `acceptance_criteria` array order in the approved Ticket Revision, never database row or ID order. Waiver Decisions follow the positions of their corresponding Outcomes.
- `outcome = 'satisfied'` requires a submitted `satisfied` Verdict for the same Result and criterion, and `waiver_decision_id` must be `NULL`.
- `outcome = 'waived'` requires a submitted `unsatisfied` Verdict for the same Result and criterion, plus a `decision_type = 'acceptance_criterion_waiver'` Decision created by the same Local Actor in the same transaction as the Result Acceptance. Other Decision types are invalid.
- The Result Acceptance's `project_id` must be non-null. Its Implementation Result, the submitted Verdict, every Outcome, and every Waiver Decision must resolve to that same Project. A Waiver Decision's `project_id` is derived from the Acceptance and must not be null or client-provided.
- The normalized waiver reason, Local Actor, and waiver time are stored only in `decisions.summary`, `decisions.actor_id`, and `decisions.created_at`. The Decision actor must equal the Result Acceptance actor, and its `created_at` must equal the Acceptance `accepted_at`; Outcomes do not copy reason, actor, or waiver time.
- The submitted Verdict remains the authority for the coding agent's assessment and evidence; the Waiver Decision remains the authority for the user's waiver.

### result_revocations

```sql
CREATE TABLE result_revocations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  result_acceptance_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  previous_delivery_status TEXT NOT NULL,
  resulting_delivery_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (result_acceptance_id) REFERENCES result_acceptances(id),
  FOREIGN KEY (decision_id) REFERENCES decisions(id)
);

CREATE UNIQUE INDEX idx_result_revocations_result_acceptance
  ON result_revocations(result_acceptance_id);
```

Notes：

- A Result Revocation directly identifies the Result Acceptance it invalidates. Its Implementation Result is derived through `result_acceptances.implementation_result_id`.
- Each Result Acceptance may have at most one Result Revocation. Because each Implementation Result may have at most one Acceptance, each Result may consequently have at most one Revocation.
- `result_revocations.project_id`, its Result Acceptance's `project_id`, and its Decision's non-null `project_id` must be identical. The application transaction derives both new rows' Project identity from the Acceptance; clients do not provide it.
- `decision_id` must reference a `decision_type = 'result_acceptance_revocation'` Decision created in the same transaction. The normalized reason, Local Actor, and revocation time are stored only in `decisions.summary`, `decisions.actor_id`, and `decisions.created_at`; `result_revocations` does not copy them.
- `revoke_result_acceptance` requires a client-provided idempotency key and must persist an Operation Receipt in the same transaction as the Decision, Result Revocation, archived Result, and Ticket status update.
- Any still-effective Acceptance backed by an active approved Result may be revoked, even when its Ticket is not `done`.
- `previous_delivery_status` records the Ticket status read inside the revocation transaction. If it is `done`, `resulting_delivery_status` must be `in_progress` or `blocked`; otherwise `resulting_delivery_status` must equal the unchanged `planned`, `in_progress`, or `blocked` previous value.
- The conditional MCP input `next_delivery_status` is not persisted as a revocation history field.
- Revocation permanently archives the Result. The Result cannot receive another Acceptance; corrected work must be submitted as a new Implementation Result.

### operation_receipt_delete_guards

```sql
CREATE TRIGGER prevent_delete_operation_receipts
BEFORE DELETE ON operation_receipts
BEGIN
  SELECT RAISE(ABORT, 'operation_receipts are immutable');
END;

CREATE TRIGGER prevent_delete_result_acceptances
BEFORE DELETE ON result_acceptances
BEGIN
  SELECT RAISE(ABORT, 'result_acceptances are immutable');
END;

CREATE TRIGGER prevent_delete_result_revocations
BEFORE DELETE ON result_revocations
BEGIN
  SELECT RAISE(ABORT, 'result_revocations are immutable');
END;

CREATE TRIGGER prevent_delete_receipted_implementation_results
BEFORE DELETE ON implementation_results
WHEN
  EXISTS (
    SELECT 1
    FROM result_acceptances
    JOIN operation_receipts
      ON operation_receipts.result_acceptance_id = result_acceptances.id
    WHERE result_acceptances.implementation_result_id = OLD.id
  )
  OR EXISTS (
    SELECT 1
    FROM result_acceptances
    JOIN result_revocations
      ON result_revocations.result_acceptance_id = result_acceptances.id
    JOIN operation_receipts
      ON operation_receipts.result_revocation_id = result_revocations.id
    WHERE result_acceptances.implementation_result_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'receipted implementation_results are immutable');
END;
```

Notes：

- Receipt, Acceptance, and Revocation delete guards are unconditional because those rows are immutable historical events without Lifecycle Status.
- The Implementation Result guard is conditional. It blocks deletion once the Result participates in an acceptance or revocation receipt replay path; archival remains the supported lifecycle transition.
- These guards protect replay retention independently of repository code and foreign-key connection settings.

### decisions

```sql
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  actor_id TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (actor_id) REFERENCES local_actors(id)
);
```

### external_containers

```sql
CREATE TABLE external_containers (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  workspace_identity TEXT NOT NULL,
  container_identity TEXT NOT NULL,
  display_name TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Indexes：

```sql
CREATE UNIQUE INDEX idx_external_containers_identity
  ON external_containers(provider, workspace_identity, container_identity);
```

### external_work_items

```sql
CREATE TABLE external_work_items (
  id TEXT PRIMARY KEY,
  external_container_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_url TEXT,
  lifecycle_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (external_container_id) REFERENCES external_containers(id)
);
```

Indexes：

```sql
CREATE UNIQUE INDEX idx_external_work_items_container_external_id
  ON external_work_items(external_container_id, external_id);
```

### external_work_item_mappings

```sql
CREATE TABLE external_work_item_mappings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  internal_owner_type TEXT NOT NULL,
  internal_owner_id TEXT NOT NULL,
  external_container_id TEXT NOT NULL,
  external_work_item_id TEXT NOT NULL,
  source_ticket_revision_id TEXT,
  lifecycle_status TEXT NOT NULL,
  next_sequence_number INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (external_container_id) REFERENCES external_containers(id),
  FOREIGN KEY (external_work_item_id) REFERENCES external_work_items(id),
  FOREIGN KEY (source_ticket_revision_id) REFERENCES ticket_revisions(id)
);
```

Indexes：

```sql
CREATE INDEX idx_external_work_item_mappings_owner
  ON external_work_item_mappings(internal_owner_type, internal_owner_id);
CREATE UNIQUE INDEX idx_external_work_item_mappings_active_owner_container
  ON external_work_item_mappings(internal_owner_type, internal_owner_id, external_container_id)
  WHERE lifecycle_status = 'active';
```

### external_work_item_snapshots

```sql
CREATE TABLE external_work_item_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  external_work_item_id TEXT NOT NULL,
  mapping_id TEXT,
  content_json TEXT NOT NULL,
  external_status TEXT,
  concurrency_token TEXT,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (external_work_item_id) REFERENCES external_work_items(id),
  FOREIGN KEY (mapping_id) REFERENCES external_work_item_mappings(id)
);
```

### content_drifts

```sql
CREATE TABLE content_drifts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mapping_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  internal_owner_type TEXT NOT NULL,
  internal_owner_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  resolution_decision_id TEXT,
  detected_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (mapping_id) REFERENCES external_work_item_mappings(id),
  FOREIGN KEY (snapshot_id) REFERENCES external_work_item_snapshots(id),
  FOREIGN KEY (resolution_decision_id) REFERENCES decisions(id)
);
```

### sync_conflicts

```sql
CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mapping_id TEXT NOT NULL,
  external_work_item_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  external_status TEXT NOT NULL,
  internal_delivery_status TEXT NOT NULL,
  source_event_json TEXT NOT NULL,
  resolution_decision_id TEXT,
  detected_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (mapping_id) REFERENCES external_work_item_mappings(id),
  FOREIGN KEY (external_work_item_id) REFERENCES external_work_items(id),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (resolution_decision_id) REFERENCES decisions(id)
);
```

### sync_intents

```sql
CREATE TABLE sync_intents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mapping_id TEXT,
  external_container_id TEXT,
  sequence_number INTEGER,
  operation TEXT NOT NULL,
  source_event_type TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_ticket_revision_id TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  supersedes_sync_intent_id TEXT,
  lifecycle_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (mapping_id) REFERENCES external_work_item_mappings(id),
  FOREIGN KEY (external_container_id) REFERENCES external_containers(id),
  FOREIGN KEY (source_ticket_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (supersedes_sync_intent_id) REFERENCES sync_intents(id)
);
```

Indexes：

```sql
CREATE UNIQUE INDEX idx_sync_intents_idempotency_key ON sync_intents(idempotency_key);
CREATE INDEX idx_sync_intents_mapping_sequence ON sync_intents(mapping_id, sequence_number);
CREATE INDEX idx_sync_intents_lifecycle_status ON sync_intents(lifecycle_status);
```

### sync_attempts

```sql
CREATE TABLE sync_attempts (
  id TEXT PRIMARY KEY,
  sync_intent_id TEXT NOT NULL,
  external_work_item_id TEXT,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result_status TEXT NOT NULL,
  response_json TEXT,
  error_json TEXT,
  FOREIGN KEY (sync_intent_id) REFERENCES sync_intents(id),
  FOREIGN KEY (external_work_item_id) REFERENCES external_work_items(id)
);
```

Indexes：

```sql
CREATE INDEX idx_sync_attempts_intent_id ON sync_attempts(sync_intent_id);
CREATE INDEX idx_sync_attempts_result_status ON sync_attempts(result_status);
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

### Review Status

```text
draft
approved
```

### Lifecycle Status

```text
active
archived
```

### Delivery Status

```text
planned
in_progress
blocked
done
```

### Graph Change Operation

```text
add
update
archive
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
implementation_target
external_work_item
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
supersedes
waives
```

### Acceptance Criterion Verdict

```text
satisfied
unsatisfied
```

### Result Acceptance Criterion Outcome

```text
satisfied
waived
```

### Observed Evidence Type

```text
commit
pull_request
test_execution
artifact
```

Payload schemas for these four types are defined by `record_observed_evidence` in `docs/12-mcp-tool-spec.md`.

All four Phase 1A payload schemas are closed schemas equivalent to JSON Schema `additionalProperties: false`. Undeclared fields are rejected before normalization and hashing.

Every payload requires an integer `schema_version`. Phase 1A accepts only `1`; because the version is inside the payload, it is included in canonicalization and `payload_hash`.

All timestamp fields in Observed Evidence payloads must use the canonical UTC millisecond format `YYYY-MM-DDTHH:mm:ss.sssZ`. Offset forms and other fractional-second precision are rejected before payload hashing.

For a `commit` payload, `changed_files` is a required string array but may be empty. Entries must be repository-relative POSIX paths; absolute paths, backslashes, and `..` path segments are rejected. Before payload hashing, the server deduplicates entries and sorts them by Unicode code point lexical order. An empty array records that no file changes were observed and does not itself satisfy an acceptance criterion.

### Pull Request Status

```text
draft
open
merged
closed
```

### Test Execution Status

```text
passed
failed
errored
cancelled
```

For a `test_execution` payload, `exit_code` is always a required field. `passed` requires `0`; `failed` requires a non-zero integer; `errored` and `cancelled` allow either `null` or an integer. `completed_at` must be greater than or equal to `started_at`.

### Sync Intent Operation

```text
create
content_update
status_update
close
reopen
```

### Sync Attempt Result Status

```text
started
succeeded
failed
```

## Migration Strategy

Phase 1A 直接建立完整 schema，不只建立 `projects` / `ideas` / `audit_log`。第一批 repository 和 use cases 可以只實作其中一部分 tables，但 migration 應一次建立完整 contract，避免早期實作依賴舊模型。

Migration runner 必須使用已由 connection factory 啟用並驗證 foreign-key enforcement 的 connection。Migration SQL 中的 `PRAGMA foreign_keys = ON` 可支援直接執行與 schema smoke，但不能取代每個 runtime connection 的初始化。

所有 pending migrations 完成後、server 開始提供任何 tool 或 resource 前，startup integrity check 必須執行：

```sql
PRAGMA foreign_key_check;
```

只有結果為空時才能完成啟動。任一回傳 row 都代表既有 storage integrity violation；server 必須回報包含 table、rowid、parent table 與 foreign-key index 的 storage integrity error 並停止，不得自動刪除、補建或改寫資料。

建議 migration layout：

```text
src/infrastructure/migrations/001_initial_schema.sql
src/infrastructure/migrations/002_initial_indexes.sql
```

## Validation Rules

- 每個 SQLite connection 必須在任何 migration、query 或 transaction 前執行 `PRAGMA foreign_keys = ON`，並讀回確認 `PRAGMA foreign_keys = 1`；無法確認時拒絕啟動或使用該 connection。
- 所有 pending migrations 完成後、server 開始服務前必須執行 `PRAGMA foreign_key_check`；結果非空時以 storage integrity error 停止啟動，不得自動修復資料。
- 所有 JSON 欄位寫入前必須 stringify 並 schema validate。
- `review_status`、`lifecycle_status`、`delivery_status` 必須符合各自 enum。
- Product Brief Version approval 必須檢查 `base_approved_version_id` 仍等於 Product Brief current approved pointer。
- Graph Draft Batch approval 必須檢查 `base_graph_revision_id` 仍等於 Project current Graph Revision。
- Graph Draft Batch approval 必須檢查 `source_product_brief_version_id` 仍等於 Product Brief current approved version。
- Empty Graph Draft Batch 只允許作為 no-op reconciliation，且必須有 `reconciliation_summary`。
- Graph edge 的 source / target node 必須屬於同一 Project。
- Ticket Revision approval 必須檢查 base pointer、source Graph Revision、產品意圖 links、dependencies 與 required Implementation Target membership。
- Observed Evidence 寫入必須檢查 evidence type payload schema、必填 repository identity、Project-scoped idempotency key、server-computed payload hash 與引用完整性；Phase 1A 只支援 `commit`、`pull_request`、`test_execution`、`artifact` 四種 closed payload schema，未宣告欄位必須在 normalization 與 hashing 前拒絕。每個 payload 必須包含 `schema_version`，Phase 1A 只接受整數 `1`，且該欄位參與 canonicalization 與 hashing。`commit.changed_files` 必須是 string array 且欄位不可省略，但可為空陣列；entries 必須是 repository-relative POSIX paths，絕對路徑、反斜線與 `..` path segment 必須被拒絕，並在 payload hashing 前去重及依 Unicode code point lexical order 排序；空陣列不代表任何 acceptance criterion 已滿足。所有 timestamp fields 必須使用固定 UTC 毫秒格式 `YYYY-MM-DDTHH:mm:ss.sssZ`，並在 payload hashing 前驗證；不接受時區 offset 或其他精度。`pull_request.status` 只允許 `draft`、`open`、`merged`、`closed`，`test_execution.status` 只允許 `passed`、`failed`、`errored`、`cancelled`。`test_execution.exit_code` 欄位必須存在：`passed` 必須為 `0`，`failed` 必須為非零整數，`errored` 與 `cancelled` 可為 `null` 或整數；`completed_at` 必須晚於或等於 `started_at`。它沒有 `review_status`、不保存 `implementation_target_id`，也不得代表 Result Acceptance。Server 必須先套用 schema-defined semantic normalization，再使用 RFC 8785 JSON Canonicalization Scheme 產生 canonical bytes 後計算 SHA-256；`payload_json` 保存實際被 hash 的 canonical JSON UTF-8 文字，Phase 1A 不保存 client 原始 payload；input 不接受 client-provided payload hash。同一 Project 內相同 idempotency key 重送時，只有 repository、evidence type 與 payload hash 都相同才回傳既有 evidence；任一不同必須回傳 `CONFLICT`。
- 同一 Observed Evidence 可被多個 Implementation Results 引用，但每個 Result 的 Implementation Target 必須屬於該 evidence 的 Repository；criterion verdicts 與 Result Acceptance 必須按 Result 獨立保存，不得因重用 evidence 而繼承。
- `implementation_result_evidence` 必須保存每個 Result 引用的完整 Observed Evidence set；`acceptance_criterion_verdicts.evidence_ids_json` 中的每個 ID 都必須存在於同一 Result 的 evidence set，否則拒絕建立 Result。
- `implementation_result_evidence` 可包含未被該 Result 任一 `acceptance_criterion_verdicts.evidence_ids_json` 引用的 evidence；這些 evidence 不得計入 criterion satisfaction 或 Result Acceptance。
- `satisfied` verdict 的 `reason` 必須在 trim 後非空，否則拒絕建立 Result。Draft Result 可保存 `evidence_ids_json = '[]'` 的 `satisfied` verdict；Result Acceptance 必須逐一驗證每個 `satisfied` verdict 具有有效 reason，並至少引用一份屬於同一 Result evidence set 的 Observed Evidence，否則拒絕 acceptance。
- `unsatisfied` verdict 的 `reason` 必須在 trim 後非空，否則拒絕建立 Result；`evidence_ids_json` 可為空，也可引用同一 Result evidence set 內的反證。除非 `accept_implementation_result` 的 waiver input 指向同一 criterion，否則無論有無 evidence，Result Acceptance 都必須拒絕。
- `submit_implementation_result` 只能建立不可變的 `satisfied` 或 `unsatisfied` verdict；若 input 包含 `waived`、client-provided `waiver_decision_id` 或 waiver decision payload，必須拒絕建立 Result。`accept_implementation_result` 不得修改 verdict、reason 或 evidence references，而必須為每項 criterion 建立 outcome：`satisfied` outcome 只能引用同 Result、同 criterion 的 `satisfied` verdict；`waived` outcome 只能引用同 Result、同 criterion 的 `unsatisfied` verdict，並綁定同一 Local Actor 在同一 transaction 建立且 `decision_type = 'acceptance_criterion_waiver'` 的 Waiver Decision；其他 Decision type 必須拒絕。Result Acceptance 的 `project_id` 必須非空；Outcome、Verdict 所屬 Result 與 Waiver Decision 必須解析到同一 Project。Waiver Decision 的 `project_id` 必須由 Acceptance 衍生，input 不得接受 client-provided waiver `project_id`、`decision_type` 或既有 Decision ID。Result Acceptance 的 `actor_id` 必須由目前 Local Actor 產生；input 若提供 acceptance actor 或 time 欄位必須拒絕。Transaction 開始時必須只擷取一次 event time，並讓 Acceptance `accepted_at`、所有 Outcomes `created_at` 與本次 Waiver Decisions `created_at` 完全相等。Trim 後的 `waivers[].reason` 必須寫入 `decisions.summary`；waiver actor 與 time 必須使用該 Decision 的 `actor_id`、`created_at`，且 actor 必須等於 Result Acceptance actor。Outcome 不得複製 reason、actor 或 time。
- `accept_implementation_result` 必須要求 client-provided idempotency key。Server 必須以 Project、目前 Local Actor、operation name 與 key 查找 Operation Receipt；相同 normalized command hash 時回放原始成功 response data，不得重新執行 writes；hash 不同時回傳 `CONFLICT`。Command fingerprint 必須先對 normalized command 使用 RFC 8785 JSON Canonicalization Scheme 產生 canonical bytes，再以 SHA-256 計算。首次成功 acceptance 必須在同一 transaction 保存 receipt，其 `response_json` 必須保存 successful `ToolResult.data` 並足以重建原始 multi-write response data；replay 時 server 重新包成目前標準的成功 envelope。
- Phase 1A 每筆 Operation Receipt 必須恰好綁定一個 domain event。`accept_implementation_result` receipt 必須設定 `result_acceptance_id` 且 `result_revocation_id` 必須為 null；`revoke_result_acceptance` receipt 必須設定 `result_revocation_id` 且 `result_acceptance_id` 必須為 null。`operation_name` 必須與被設定的 FK 一致。
- 每個 Result Acceptance 與每個 Result Revocation 最多只能被一筆 Operation Receipt 引用，不得用不同 idempotency keys 建立多筆 receipts 指向同一 domain event。
- 不同 idempotency key 一律是不同 logical command；若目標 Result 或 Acceptance 已被先前成功操作改變狀態，必須回傳一般 `CONFLICT`，不得依 target identity 或既有 event 反查 receipt 並當作 replay。
- `accept_implementation_result` 與 `revoke_result_acceptance` input 都不包含 `project_id`。Server 必須分別以 `implementation_result_id` 或 `result_acceptance_id` 做 identity-only resolution，只確認 target identity 存在並取得 Project scope；此步不得檢查 lifecycle、current state、既有 Acceptance／Revocation 或其他 business validity。
- Identity-only resolution 找不到 target 時必須立即回傳 `NOT_FOUND`；無法取得 Project scope 時不得查找或建立 Operation Receipt。
- Receipt lookup 必須先於 target state validation；同一 Project、Local Actor、operation、key 與相同 command hash 命中 receipt 時必須直接 replay，即使目標 Result 或 Acceptance 已因原成功 transaction 而不再可執行。
- 只有 receipt miss 時才執行完整 target state validation。
- Operation Receipt 與其 replay 路徑上的 Implementation Result、Result Acceptance、Result Revocation 都不得 hard delete。Implementation Result 只能透過 Lifecycle Status archive；Receipt、Acceptance 與 Revocation 沒有 Lifecycle Status，必須永久保留。
- SQLite 必須以 delete-guard triggers 無條件拒絕刪除 Operation Receipt、Result Acceptance 與 Result Revocation；Implementation Result 已可經 Acceptance 或 Revocation 連到 Receipt 時，也必須拒絕刪除。
- Operation Receipt 只在 domain transaction 成功提交後保存；validation error、`NOT_FOUND`、`CONFLICT`、`STALE_HANDOFF`、`STORAGE_ERROR` 或其他失敗 response 不得保存或 replay。
- Operation Receipt replay 不得在 domain response data 中新增 `replayed`、`receipt_id`、`idempotency_key` 或其他 replay marker。
- Replay observability 只能透過 audit log、server log 或非 domain envelope metadata 表示，不得改變 `ToolResult.data`。
- Replay response 的 top-level `audit_log_id` 必須使用 receipt 保存的原始 domain transaction audit log ID；replay observability log ID 不得取代它。
- 每個 Implementation Result 最多只能建立一筆 `result_acceptances`；每筆 Result Acceptance 最多只能建立一筆直接引用它的 `result_revocations`，Implementation Result 必須透過 Acceptance 關係衍生。Revocation 必須永久 archive Result；既有 Acceptance 即使已撤銷，也不得對同一 Result 再次建立 Acceptance，修正必須提交新的 Implementation Result。
- 任何仍有效且對應 active approved Result 的 Result Acceptance 都可撤銷，不要求 Ticket 已是 `done`。Result Revocation 必須保存操作 transaction 內讀取的 `previous_delivery_status` 與實際寫入或保留的 `resulting_delivery_status`。若 previous 是 `done`，resulting 必須是 `in_progress` 或 `blocked`；若 previous 尚未完成，resulting 必須等於原本的 `planned`、`in_progress` 或 `blocked`。
- `revoke_result_acceptance` 必須要求 client-provided idempotency key。Server 必須以 Project、目前 Local Actor、operation name 與 key 查找 Operation Receipt；相同 normalized command hash 時回放原始成功 response data，不得重新執行 writes；hash 不同時回傳 `CONFLICT`。Command fingerprint 必須先對 normalized command 使用 RFC 8785 JSON Canonicalization Scheme 產生 canonical bytes，再以 SHA-256 計算。首次成功 revocation 必須在同一 transaction 保存 receipt，其 `response_json` 必須保存 successful `ToolResult.data` 並足以重建原始 multi-write response data；replay 時 server 重新包成目前標準的成功 envelope。
- `revoke_result_acceptance.reason` 必須在 trim 後非空，並寫入同一 transaction 建立且 `decision_type = 'result_acceptance_revocation'` 的 `decisions.summary`。撤銷人與撤銷時間必須分別使用該 Decision 的 `actor_id` 與 `created_at`；`result_revocations` 只能保存 `decision_id`，不得複製 reason、actor 或 time。
- Result Revocation、其 Result Acceptance 與所引用 Decision 必須具有相同 Project identity；該 Decision 的 `project_id` 在此 use case 必須非空。Revocation 與 Decision 的 `project_id` 必須由 Acceptance 衍生，input 不得接受 client-provided `project_id`。
- 同一 Ticket + Repository 最多只能有一個 active Implementation Target。
- 同一 Implementation Target 最多只能有一份 active approved Implementation Brief。
- 同一 Implementation Target 最多只能有一份 active approved Implementation Result。
- Ticket `done` 必須由目前 approved Ticket Revision 的所有 required Implementation Targets 的 active approved Results 支撐。
- External Work Item mapping 的 active uniqueness 以 internal owner + External Container 判定。
- Sync Intents 必須在 internal domain transaction 中 durable 寫入；外部 API calls 只能在 commit 後透過 Sync Attempts 執行。
- 曾經 canonical 或被引用的 entities 不 hard delete；退出目前有效範圍一律 archive。
