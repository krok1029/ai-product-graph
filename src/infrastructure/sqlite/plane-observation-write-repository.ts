import type { PlaneObservationWriteRepository } from "../../application/plane-observation-ports.js";
import { canonicalizeJson } from "../../application/canonical-json.js";
import type { SqliteDatabase } from "./database.js";

export function createPlaneObservationWriteRepository(database: SqliteDatabase): PlaneObservationWriteRepository {
  return {
    insertCapture({ snapshot, observation, drift }) {
      if (!database.inTransaction) throw new Error("Plane observation capture requires an active transaction.");
      const valid = snapshot.id === observation.snapshotId && snapshot.projectId === observation.projectId &&
        snapshot.mappingId === observation.mappingId && snapshot.externalWorkItemId === observation.externalWorkItemId &&
        (!drift || (drift.projectId === observation.projectId && drift.mappingId === observation.mappingId &&
          drift.externalWorkItemSnapshotId === snapshot.id && drift.resolutionDecisionId === null &&
          drift.diff.schema_version === 1 && drift.diff.source_ticket_revision_id === observation.sourceTicketRevisionId &&
          drift.diff.changes.length > 0));
      const scope = database.prepare(`SELECT 1 FROM external_work_item_mappings m
        JOIN tickets t ON t.id = m.internal_owner_id AND t.project_id = m.project_id
        JOIN ticket_revisions r ON r.ticket_id = t.id AND r.project_id = t.project_id
        JOIN external_work_items i ON i.id = m.external_work_item_id AND i.external_container_id = m.external_container_id
        JOIN audit_log a ON a.project_id = m.project_id AND a.actor_id = ?
        WHERE m.id = ? AND m.project_id = ? AND m.internal_owner_type = 'ticket' AND t.id = ?
          AND i.id = ? AND r.id = ? AND r.review_status = 'approved'
          AND a.id = ? AND a.entity_type = 'plane_observation' AND a.entity_id = ? AND a.action = 'plane_mapping.observed'`)
        .get(observation.actorId, observation.mappingId, observation.projectId, observation.ticketId,
          observation.externalWorkItemId, observation.sourceTicketRevisionId, observation.auditLogId, snapshot.id);
      if (!valid || !scope) throw new Error("Plane observation capture has invalid provenance.");
      database.prepare(`INSERT INTO external_work_item_snapshots (id, project_id, external_work_item_id,
        mapping_id, content_json, external_status, concurrency_token, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(snapshot.id, snapshot.projectId, snapshot.externalWorkItemId, snapshot.mappingId,
          canonicalizeJson(snapshot.content), snapshot.externalStatus, snapshot.concurrencyToken, snapshot.capturedAt);
      database.prepare(`INSERT INTO plane_observations (snapshot_id, project_id, mapping_id, external_work_item_id,
        ticket_id, source_ticket_revision_id, actor_id, audit_log_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(observation.snapshotId, observation.projectId, observation.mappingId, observation.externalWorkItemId,
          observation.ticketId, observation.sourceTicketRevisionId, observation.actorId, observation.auditLogId);
      if (drift) database.prepare(`INSERT INTO content_drifts (id, project_id, mapping_id, snapshot_id,
        internal_owner_type, internal_owner_id, diff_json, resolution_decision_id, detected_at)
        VALUES (?, ?, ?, ?, 'ticket', ?, ?, NULL, ?)`)
        .run(drift.id, drift.projectId, drift.mappingId, drift.externalWorkItemSnapshotId, observation.ticketId,
          canonicalizeJson(drift.diff), drift.detectedAt);
    }
  };
}
