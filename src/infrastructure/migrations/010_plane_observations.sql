CREATE TABLE plane_observations (
  snapshot_id TEXT PRIMARY KEY REFERENCES external_work_item_snapshots(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  mapping_id TEXT NOT NULL REFERENCES external_work_item_mappings(id),
  external_work_item_id TEXT NOT NULL REFERENCES external_work_items(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  source_ticket_revision_id TEXT NOT NULL REFERENCES ticket_revisions(id),
  actor_id TEXT NOT NULL REFERENCES local_actors(id),
  audit_log_id TEXT NOT NULL UNIQUE REFERENCES audit_log(id)
);
CREATE INDEX plane_observations_mapping ON plane_observations(mapping_id, snapshot_id);

CREATE TRIGGER plane_observations_no_update BEFORE UPDATE ON plane_observations
BEGIN SELECT RAISE(ABORT, 'Plane observation is immutable'); END;
CREATE TRIGGER plane_observations_no_delete BEFORE DELETE ON plane_observations
BEGIN SELECT RAISE(ABORT, 'Plane observation is immutable'); END;
CREATE TRIGGER plane_observation_snapshot_no_update BEFORE UPDATE ON external_work_item_snapshots
WHEN EXISTS (SELECT 1 FROM plane_observations WHERE snapshot_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Plane observation snapshot is immutable'); END;
CREATE TRIGGER plane_observation_snapshot_no_delete BEFORE DELETE ON external_work_item_snapshots
WHEN EXISTS (SELECT 1 FROM plane_observations WHERE snapshot_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Plane observation snapshot is immutable'); END;
CREATE TRIGGER plane_observation_drift_unique BEFORE INSERT ON content_drifts
WHEN EXISTS (SELECT 1 FROM plane_observations WHERE snapshot_id = NEW.snapshot_id)
  AND EXISTS (SELECT 1 FROM content_drifts WHERE snapshot_id = NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT, 'Plane observation already has a Content Drift'); END;
CREATE TRIGGER content_drift_detection_immutable BEFORE UPDATE ON content_drifts
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.mapping_id IS NOT OLD.mapping_id OR NEW.snapshot_id IS NOT OLD.snapshot_id
  OR NEW.internal_owner_type IS NOT OLD.internal_owner_type OR NEW.internal_owner_id IS NOT OLD.internal_owner_id
  OR NEW.diff_json IS NOT OLD.diff_json OR NEW.detected_at IS NOT OLD.detected_at
BEGIN SELECT RAISE(ABORT, 'Content Drift detection is immutable'); END;
CREATE TRIGGER content_drift_no_delete BEFORE DELETE ON content_drifts
BEGIN SELECT RAISE(ABORT, 'Content Drift detection is immutable'); END;
