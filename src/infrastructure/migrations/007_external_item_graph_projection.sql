-- rebuild-with-integrity-check
-- External Work Item 投影採固定 identity，不偽造產品意圖 Graph Revision。
DROP TRIGGER project_ticket_graph_node_after_insert;
DROP TRIGGER project_ticket_graph_node_after_update;
DROP TRIGGER validate_ticket_graph_edge_insert;
DROP TRIGGER validate_ticket_graph_edge_update;
CREATE TABLE graph_nodes_replacement (
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
  created_in_graph_revision_id TEXT,
  last_changed_in_graph_revision_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (
    (type = 'ticket' AND source = 'ticket' AND source_ref_type IS 'ticket'
      AND source_ref_id IS id AND created_in_graph_revision_id IS NULL
      AND last_changed_in_graph_revision_id IS NULL)
    OR (type = 'external_work_item' AND source = 'external_work_item'
      AND source_ref_type IS 'external_work_item' AND source_ref_id IS id
      AND created_in_graph_revision_id IS NULL AND last_changed_in_graph_revision_id IS NULL)
    OR (type NOT IN ('ticket', 'external_work_item') AND created_in_graph_revision_id IS NOT NULL
      AND last_changed_in_graph_revision_id IS NOT NULL)
  ),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_in_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (last_changed_in_graph_revision_id) REFERENCES graph_revisions(id)
);
INSERT INTO graph_nodes_replacement SELECT * FROM graph_nodes;
DROP TABLE graph_nodes;
ALTER TABLE graph_nodes_replacement RENAME TO graph_nodes;
CREATE INDEX idx_graph_nodes_project_id ON graph_nodes(project_id);
CREATE INDEX idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX idx_graph_nodes_lifecycle_status ON graph_nodes(lifecycle_status);
CREATE UNIQUE INDEX idx_graph_nodes_project_slug ON graph_nodes(project_id, slug);
-- Ticket aggregate 是投影的唯一寫入來源；revision drafts 不修改 aggregate。
CREATE TRIGGER project_ticket_graph_node_after_insert AFTER INSERT ON tickets
BEGIN
  INSERT INTO graph_nodes (
    id, project_id, slug, type, title, source, source_ref_type, source_ref_id,
    lifecycle_status, created_at, updated_at, archived_at
  ) VALUES (
    NEW.id, NEW.project_id, 'ticket:' || NEW.id, 'ticket', NEW.title,
    'ticket', 'ticket', NEW.id, NEW.lifecycle_status,
    NEW.created_at, NEW.updated_at, NEW.archived_at
  );
END;
CREATE TRIGGER project_ticket_graph_node_after_update
AFTER UPDATE OF title, lifecycle_status ON tickets
BEGIN
  UPDATE graph_nodes SET title = NEW.title, lifecycle_status = NEW.lifecycle_status,
    updated_at = NEW.updated_at, archived_at = NEW.archived_at
  WHERE id = NEW.id AND type = 'ticket';
END;

CREATE TRIGGER validate_ticket_graph_edge_insert BEFORE INSERT ON graph_edges
WHEN NEW.created_in_graph_revision_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Graph edge without revision provenance must have a canonical owner')
  WHERE NOT EXISTS (
    SELECT 1 FROM graph_nodes source JOIN graph_nodes target
      ON target.id = NEW.target_node_id
    WHERE source.id = NEW.source_node_id AND (source.type = 'ticket' OR (source.type = 'external_work_item'
        AND NEW.relation_type = 'traces_to' AND EXISTS (
          SELECT 1 FROM external_work_item_mappings mapping
          WHERE mapping.external_work_item_id = source.id AND mapping.internal_owner_type = 'ticket'
            AND mapping.internal_owner_id = target.id AND mapping.project_id = NEW.project_id
        )))
      AND target.type = 'ticket' AND source.project_id = NEW.project_id
      AND target.project_id = NEW.project_id
  );
END;

CREATE TRIGGER validate_ticket_graph_edge_update BEFORE UPDATE ON graph_edges
WHEN NEW.created_in_graph_revision_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Graph edge without revision provenance must have a canonical owner')
  WHERE NOT EXISTS (
    SELECT 1 FROM graph_nodes source JOIN graph_nodes target
      ON target.id = NEW.target_node_id
    WHERE source.id = NEW.source_node_id AND (source.type = 'ticket' OR (source.type = 'external_work_item'
        AND NEW.relation_type = 'traces_to' AND EXISTS (
          SELECT 1 FROM external_work_item_mappings mapping
          WHERE mapping.external_work_item_id = source.id AND mapping.internal_owner_type = 'ticket'
            AND mapping.internal_owner_id = target.id AND mapping.project_id = NEW.project_id
        )))
      AND target.type = 'ticket' AND source.project_id = NEW.project_id
      AND target.project_id = NEW.project_id
  );
END;

-- Follow-up 的 establishing revision 規則只屬於 Ticket → Ticket lineage。
DROP TRIGGER validate_ticket_lineage_insert;
CREATE TRIGGER validate_ticket_lineage_insert BEFORE INSERT ON graph_edges
WHEN NEW.created_in_graph_revision_id IS NULL AND NEW.relation_type = 'traces_to'
  AND EXISTS (SELECT 1 FROM graph_nodes WHERE id = NEW.source_node_id AND type = 'ticket')
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
