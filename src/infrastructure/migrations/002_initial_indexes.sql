-- Generated from docs/13-sqlite-schema.md.
CREATE INDEX idx_repositories_project_id ON repositories(project_id);
CREATE UNIQUE INDEX idx_repositories_project_slug ON repositories(project_id, slug);
CREATE INDEX idx_ideas_project_id ON ideas(project_id);
CREATE UNIQUE INDEX idx_ideas_project_slug ON ideas(project_id, slug);
CREATE INDEX idx_product_briefs_project_id ON product_briefs(project_id);
CREATE UNIQUE INDEX idx_product_briefs_project_slug ON product_briefs(project_id, slug);
CREATE INDEX idx_product_brief_versions_project_id ON product_brief_versions(project_id);
CREATE INDEX idx_product_brief_versions_brief_id ON product_brief_versions(product_brief_id);
CREATE UNIQUE INDEX idx_product_brief_versions_number ON product_brief_versions(product_brief_id, version_number);
CREATE INDEX idx_graph_draft_batch_changes_batch_id ON graph_draft_batch_changes(graph_draft_batch_id);
CREATE UNIQUE INDEX idx_graph_draft_batch_changes_change_id ON graph_draft_batch_changes(graph_draft_batch_id, change_id);
CREATE UNIQUE INDEX idx_graph_revisions_project_sequence ON graph_revisions(project_id, sequence_number);
CREATE INDEX idx_graph_revisions_source_version ON graph_revisions(source_product_brief_version_id);
CREATE INDEX idx_graph_nodes_project_id ON graph_nodes(project_id);
CREATE INDEX idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX idx_graph_nodes_lifecycle_status ON graph_nodes(lifecycle_status);
CREATE UNIQUE INDEX idx_graph_nodes_project_slug ON graph_nodes(project_id, slug);
CREATE INDEX idx_graph_edges_project_id ON graph_edges(project_id);
CREATE INDEX idx_graph_edges_source_node_id ON graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target_node_id ON graph_edges(target_node_id);
CREATE INDEX idx_graph_edges_relation_type ON graph_edges(relation_type);
CREATE INDEX idx_graph_edges_lifecycle_status ON graph_edges(lifecycle_status);
CREATE INDEX idx_tickets_project_id ON tickets(project_id);
CREATE INDEX idx_tickets_lifecycle_status ON tickets(lifecycle_status);
CREATE INDEX idx_tickets_delivery_status ON tickets(delivery_status);
CREATE UNIQUE INDEX idx_tickets_project_slug ON tickets(project_id, slug);
CREATE INDEX idx_ticket_revisions_project_id ON ticket_revisions(project_id);
CREATE INDEX idx_ticket_revisions_ticket_id ON ticket_revisions(ticket_id);
CREATE UNIQUE INDEX idx_ticket_revisions_number ON ticket_revisions(ticket_id, revision_number);
CREATE INDEX idx_implementation_targets_project_id ON implementation_targets(project_id);
CREATE INDEX idx_implementation_targets_ticket_id ON implementation_targets(ticket_id);
CREATE UNIQUE INDEX idx_implementation_targets_active_ticket_repository
  ON implementation_targets(ticket_id, repository_id)
  WHERE lifecycle_status = 'active';
CREATE INDEX idx_implementation_briefs_target_id ON implementation_briefs(implementation_target_id);
CREATE INDEX idx_implementation_briefs_ticket_revision_id ON implementation_briefs(ticket_revision_id);
CREATE UNIQUE INDEX idx_implementation_briefs_active_approved_target
  ON implementation_briefs(implementation_target_id)
  WHERE review_status = 'approved' AND lifecycle_status = 'active';
CREATE INDEX idx_observed_evidence_project_id ON observed_evidence(project_id);
CREATE INDEX idx_observed_evidence_repository_id ON observed_evidence(repository_id);
CREATE INDEX idx_observed_evidence_type ON observed_evidence(evidence_type);
CREATE INDEX idx_observed_evidence_payload_hash ON observed_evidence(payload_hash);
CREATE UNIQUE INDEX idx_observed_evidence_project_idempotency_key
  ON observed_evidence(project_id, idempotency_key);
CREATE INDEX idx_implementation_results_target_id ON implementation_results(implementation_target_id);
CREATE INDEX idx_implementation_results_ticket_revision_id ON implementation_results(ticket_revision_id);
CREATE UNIQUE INDEX idx_implementation_results_active_approved_target
  ON implementation_results(implementation_target_id)
  WHERE review_status = 'approved' AND lifecycle_status = 'active';
CREATE UNIQUE INDEX idx_result_acceptances_implementation_result
  ON result_acceptances(implementation_result_id);
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
CREATE UNIQUE INDEX idx_result_acceptance_criterion_outcomes_criterion
  ON result_acceptance_criterion_outcomes(result_acceptance_id, acceptance_criterion_id);
CREATE UNIQUE INDEX idx_result_revocations_result_acceptance
  ON result_revocations(result_acceptance_id);
CREATE UNIQUE INDEX idx_external_containers_identity
  ON external_containers(provider, workspace_identity, container_identity);
CREATE UNIQUE INDEX idx_external_work_items_container_external_id
  ON external_work_items(external_container_id, external_id);
CREATE INDEX idx_external_work_item_mappings_owner
  ON external_work_item_mappings(internal_owner_type, internal_owner_id);
CREATE UNIQUE INDEX idx_external_work_item_mappings_active_owner_container
  ON external_work_item_mappings(internal_owner_type, internal_owner_id, external_container_id)
  WHERE lifecycle_status = 'active';
CREATE UNIQUE INDEX idx_sync_intents_idempotency_key ON sync_intents(idempotency_key);
CREATE INDEX idx_sync_intents_mapping_sequence ON sync_intents(mapping_id, sequence_number);
CREATE INDEX idx_sync_intents_lifecycle_status ON sync_intents(lifecycle_status);
CREATE INDEX idx_sync_attempts_intent_id ON sync_attempts(sync_intent_id);
CREATE INDEX idx_sync_attempts_result_status ON sync_attempts(result_status);
CREATE INDEX idx_audit_log_project_id ON audit_log(project_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
