-- rebuild-with-integrity-check
-- 重建後在同一 transaction 驗證所有 foreign keys，成功後才提交。
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
    OR (type <> 'ticket' AND created_in_graph_revision_id IS NOT NULL
      AND last_changed_in_graph_revision_id IS NOT NULL)
  ),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_in_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (last_changed_in_graph_revision_id) REFERENCES graph_revisions(id)
);
INSERT INTO graph_nodes_replacement SELECT * FROM graph_nodes;
DROP TABLE graph_nodes;
ALTER TABLE graph_nodes_replacement RENAME TO graph_nodes;
CREATE TABLE graph_edges_replacement (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL,
  lifecycle_status TEXT NOT NULL,
  created_in_graph_revision_id TEXT,
  last_changed_in_graph_revision_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((created_in_graph_revision_id IS NULL) =
    (last_changed_in_graph_revision_id IS NULL)),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (source_node_id) REFERENCES graph_nodes(id),
  FOREIGN KEY (target_node_id) REFERENCES graph_nodes(id),
  FOREIGN KEY (created_in_graph_revision_id) REFERENCES graph_revisions(id),
  FOREIGN KEY (last_changed_in_graph_revision_id) REFERENCES graph_revisions(id)
);
INSERT INTO graph_edges_replacement SELECT * FROM graph_edges;
DROP TABLE graph_edges;
ALTER TABLE graph_edges_replacement RENAME TO graph_edges;
CREATE INDEX idx_graph_nodes_project_id ON graph_nodes(project_id);
CREATE INDEX idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX idx_graph_nodes_lifecycle_status ON graph_nodes(lifecycle_status);
CREATE UNIQUE INDEX idx_graph_nodes_project_slug ON graph_nodes(project_id, slug);
CREATE INDEX idx_graph_edges_project_id ON graph_edges(project_id);
CREATE INDEX idx_graph_edges_source_node_id ON graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target_node_id ON graph_edges(target_node_id);
CREATE INDEX idx_graph_edges_relation_type ON graph_edges(relation_type);
CREATE INDEX idx_graph_edges_lifecycle_status ON graph_edges(lifecycle_status);

INSERT INTO graph_nodes (
  id, project_id, slug, type, title, source, source_ref_type, source_ref_id,
  lifecycle_status, created_at, updated_at, archived_at
)
SELECT id, project_id, 'ticket:' || id, 'ticket', title, 'ticket', 'ticket', id,
  lifecycle_status, created_at, updated_at, archived_at FROM tickets;

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
  SELECT RAISE(ABORT, 'Graph edge without revision provenance must be Ticket-owned')
  WHERE NOT EXISTS (
    SELECT 1 FROM graph_nodes source JOIN graph_nodes target
      ON target.id = NEW.target_node_id
    WHERE source.id = NEW.source_node_id AND source.type = 'ticket'
      AND target.type = 'ticket' AND source.project_id = NEW.project_id
      AND target.project_id = NEW.project_id
  );
END;

CREATE TRIGGER validate_ticket_graph_edge_update BEFORE UPDATE ON graph_edges
WHEN NEW.created_in_graph_revision_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Graph edge without revision provenance must be Ticket-owned')
  WHERE NOT EXISTS (
    SELECT 1 FROM graph_nodes source JOIN graph_nodes target
      ON target.id = NEW.target_node_id
    WHERE source.id = NEW.source_node_id AND source.type = 'ticket'
      AND target.type = 'ticket' AND source.project_id = NEW.project_id
      AND target.project_id = NEW.project_id
  );
END;
