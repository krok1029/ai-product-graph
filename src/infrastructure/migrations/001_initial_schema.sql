-- Generated from docs/13-sqlite-schema.md.
PRAGMA foreign_keys = ON;
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE local_actors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
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
CREATE TABLE ticket_revision_graph_nodes (
  ticket_revision_id TEXT NOT NULL,
  graph_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ticket_revision_id, graph_node_id, relation_type),
  FOREIGN KEY (ticket_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (graph_node_id) REFERENCES graph_nodes(id)
);
CREATE TABLE ticket_revision_dependencies (
  ticket_revision_id TEXT NOT NULL,
  depends_on_ticket_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ticket_revision_id, depends_on_ticket_id),
  FOREIGN KEY (ticket_revision_id) REFERENCES ticket_revisions(id),
  FOREIGN KEY (depends_on_ticket_id) REFERENCES tickets(id)
);
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
CREATE TABLE implementation_result_evidence (
  implementation_result_id TEXT NOT NULL,
  observed_evidence_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (implementation_result_id, observed_evidence_id),
  FOREIGN KEY (implementation_result_id) REFERENCES implementation_results(id),
  FOREIGN KEY (observed_evidence_id) REFERENCES observed_evidence(id)
);
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
