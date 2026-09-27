-- Forward backfill 由同 transaction 的 TypeScript hook 產生 canonical ULID。
-- 每個 Follow-up 只能有一個目前有效的 original；歷史 edge 保留。
CREATE TRIGGER validate_ticket_lineage_insert BEFORE INSERT ON graph_edges
WHEN NEW.created_in_graph_revision_id IS NULL AND NEW.relation_type = 'traces_to'
BEGIN
  SELECT RAISE(ABORT, 'Ticket lineage cannot reference itself')
    WHERE NEW.source_node_id = NEW.target_node_id;
  SELECT RAISE(ABORT, 'Ticket lineage requires owner and establishing revision')
    WHERE json_extract(NEW.metadata_json, '$.owner_ticket_id') IS NOT NEW.source_node_id
      OR NOT EXISTS (SELECT 1 FROM ticket_revisions
        WHERE id = json_extract(NEW.metadata_json, '$.established_by_ticket_revision_id')
          AND ticket_id = NEW.source_node_id AND project_id = NEW.project_id);
  SELECT RAISE(ABORT, 'Ticket already has active lineage')
    WHERE NEW.lifecycle_status = 'active' AND EXISTS (SELECT 1 FROM graph_edges
      WHERE source_node_id = NEW.source_node_id AND relation_type = 'traces_to'
        AND created_in_graph_revision_id IS NULL AND lifecycle_status = 'active');
END;
CREATE TRIGGER protect_ticket_lineage_update BEFORE UPDATE ON graph_edges
WHEN OLD.created_in_graph_revision_id IS NULL AND OLD.relation_type = 'traces_to'
BEGIN
  SELECT RAISE(ABORT, 'Ticket lineage identity and provenance are immutable')
    WHERE NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
      OR NEW.source_node_id IS NOT OLD.source_node_id OR NEW.target_node_id IS NOT OLD.target_node_id
      OR NEW.relation_type IS NOT OLD.relation_type OR NEW.metadata_json IS NOT OLD.metadata_json
      OR NEW.created_in_graph_revision_id IS NOT NULL OR NEW.last_changed_in_graph_revision_id IS NOT NULL
      OR NEW.created_at IS NOT OLD.created_at
      OR (OLD.lifecycle_status = 'archived' AND NEW.lifecycle_status <> 'archived');
END;
