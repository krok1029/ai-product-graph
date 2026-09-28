CREATE TABLE content_drift_resolutions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  content_drift_id TEXT NOT NULL UNIQUE REFERENCES content_drifts(id),
  decision_id TEXT NOT NULL UNIQUE REFERENCES decisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('reject', 'adopt')),
  draft_ticket_revision_id TEXT UNIQUE REFERENCES ticket_revisions(id),
  audit_log_id TEXT NOT NULL UNIQUE REFERENCES audit_log(id),
  CHECK ((kind = 'reject' AND draft_ticket_revision_id IS NULL)
    OR (kind = 'adopt' AND draft_ticket_revision_id IS NOT NULL))
);

CREATE TRIGGER content_drift_resolution_valid_insert BEFORE INSERT ON content_drift_resolutions
WHEN NOT EXISTS (
  SELECT 1 FROM content_drifts drift
  JOIN decisions decision ON decision.id = NEW.decision_id AND decision.project_id = NEW.project_id
    AND decision.decision_type = CASE NEW.kind WHEN 'reject' THEN 'content_drift_rejection' ELSE 'content_drift_adoption' END
    AND length(trim(decision.summary)) > 0 AND trim(decision.summary) = decision.summary
  JOIN local_actors actor ON actor.id = decision.actor_id
  JOIN audit_log audit ON audit.id = NEW.audit_log_id AND audit.project_id = NEW.project_id
    AND audit.actor_id = decision.actor_id AND audit.actor_type = 'mcp_client'
    AND audit.created_at = decision.created_at AND audit.entity_type = 'content_drift_resolution'
    AND audit.entity_id = NEW.id
    AND audit.action = CASE NEW.kind WHEN 'reject' THEN 'content_drift.rejected' ELSE 'content_drift.adopted' END
  WHERE drift.id = NEW.content_drift_id AND drift.project_id = NEW.project_id
    AND drift.internal_owner_type = 'ticket'
    AND (drift.resolution_decision_id IS NULL OR drift.resolution_decision_id = NEW.decision_id)
    AND (NEW.kind = 'reject' OR EXISTS (
      SELECT 1 FROM ticket_revisions draft
      JOIN ticket_revisions base ON base.id = draft.base_approved_revision_id
        AND base.ticket_id = draft.ticket_id AND base.project_id = draft.project_id AND base.review_status = 'approved'
      JOIN graph_revisions graph ON graph.id = draft.source_graph_revision_id AND graph.project_id = draft.project_id
      WHERE draft.id = NEW.draft_ticket_revision_id AND draft.project_id = NEW.project_id
        AND draft.ticket_id = drift.internal_owner_id AND draft.review_status = 'draft'
        AND draft.lifecycle_status = 'active' AND draft.created_at = decision.created_at
    ))
)
BEGIN SELECT RAISE(ABORT, 'Content Drift resolution has invalid provenance'); END;

CREATE TRIGGER content_drift_resolutions_no_update BEFORE UPDATE ON content_drift_resolutions
BEGIN SELECT RAISE(ABORT, 'Content Drift resolution is immutable'); END;
CREATE TRIGGER content_drift_resolutions_no_delete BEFORE DELETE ON content_drift_resolutions
BEGIN SELECT RAISE(ABORT, 'Content Drift resolution is immutable'); END;
CREATE TRIGGER content_drift_resolution_decision_no_update BEFORE UPDATE ON decisions
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE decision_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Content Drift resolution Decision is immutable'); END;
CREATE TRIGGER content_drift_resolution_decision_no_delete BEFORE DELETE ON decisions
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE decision_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Content Drift resolution Decision is immutable'); END;
CREATE TRIGGER content_drift_resolution_reference_immutable BEFORE UPDATE OF resolution_decision_id ON content_drifts
WHEN NEW.resolution_decision_id IS NOT OLD.resolution_decision_id
BEGIN SELECT RAISE(ABORT, 'Content Drift raw resolution reference is immutable'); END;

-- 僅鎖定 adopted revision 的內容與來源；正常 approval 和 stale sibling archival 仍可更新。
CREATE TRIGGER adopted_ticket_revision_content_immutable BEFORE UPDATE ON ticket_revisions
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = OLD.id)
  AND (NEW.id IS NOT OLD.id OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.project_id IS NOT OLD.project_id
    OR NEW.ticket_draft_batch_id IS NOT OLD.ticket_draft_batch_id OR NEW.revision_number IS NOT OLD.revision_number
    OR NEW.base_approved_revision_id IS NOT OLD.base_approved_revision_id
    OR NEW.source_graph_revision_id IS NOT OLD.source_graph_revision_id OR NEW.title IS NOT OLD.title
    OR NEW.specification_json IS NOT OLD.specification_json OR NEW.required_targets_json IS NOT OLD.required_targets_json
    OR NEW.metadata_json IS NOT OLD.metadata_json OR NEW.created_at IS NOT OLD.created_at)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision content is immutable'); END;
CREATE TRIGGER adopted_ticket_revision_no_delete BEFORE DELETE ON ticket_revisions
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision is immutable'); END;

CREATE TRIGGER adopted_ticket_revision_graph_nodes_insert BEFORE INSERT ON ticket_revision_graph_nodes
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = NEW.ticket_revision_id)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision sources are immutable'); END;

CREATE TRIGGER adopted_ticket_revision_graph_nodes_update BEFORE UPDATE ON ticket_revision_graph_nodes
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = OLD.ticket_revision_id)
  OR EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = NEW.ticket_revision_id)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision sources are immutable'); END;

CREATE TRIGGER adopted_ticket_revision_graph_nodes_delete BEFORE DELETE ON ticket_revision_graph_nodes
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = OLD.ticket_revision_id)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision sources are immutable'); END;

CREATE TRIGGER adopted_ticket_revision_dependencies_insert BEFORE INSERT ON ticket_revision_dependencies
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = NEW.ticket_revision_id)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision sources are immutable'); END;

CREATE TRIGGER adopted_ticket_revision_dependencies_update BEFORE UPDATE ON ticket_revision_dependencies
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = OLD.ticket_revision_id)
  OR EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = NEW.ticket_revision_id)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision sources are immutable'); END;

CREATE TRIGGER adopted_ticket_revision_dependencies_delete BEFORE DELETE ON ticket_revision_dependencies
WHEN EXISTS (SELECT 1 FROM content_drift_resolutions WHERE draft_ticket_revision_id = OLD.ticket_revision_id)
BEGIN SELECT RAISE(ABORT, 'Adopted Ticket Revision sources are immutable'); END;
