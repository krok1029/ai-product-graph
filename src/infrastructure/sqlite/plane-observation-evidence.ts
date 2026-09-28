// 單筆處置與歷史列表共用 captured evidence 檢查，不與目前 Ticket 規格重新比較。
import { z } from "zod";
import { ApplicationError } from "../../domain/errors.js";
import type { ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../../domain/external-work-item.js";
import type { ContentDrift, PlaneObservation } from "../../domain/plane-observation.js";

const managedFields = ["name", "description_html", "external_source", "external_id"] as const;
const diffSchema = z.object({
  schema_version: z.literal(1), source_ticket_revision_id: z.string().min(1),
  changes: z.array(z.object({ field: z.enum(managedFields), expected: z.string(),
    observed: z.union([z.object({ present: z.literal(false) }).strict(),
      z.object({ present: z.literal(true), value: z.string().nullable() }).strict()])
  }).strict()).min(1)
}).strict();

export type ObservationRow = PlaneObservation & {
  snapshotProjectId: string | null; snapshotMappingId: string | null; snapshotItemId: string | null;
  contentJson: string | null; externalStatus: string | null; concurrencyToken: string | null;
  capturedAt: string | null; validScope: number;
  auditBeforeJson: string | null; auditAfterJson: string | null; auditMetadataJson: string;
};
export type DriftRow = Omit<ContentDrift, "diff"> & {
  diffJson: string; ownerType: string; ownerId: string; decisionProjectId: string | null;
};
export const observationSelect = `SELECT o.snapshot_id AS snapshotId, o.project_id AS projectId,
  o.mapping_id AS mappingId, o.external_work_item_id AS externalWorkItemId, o.ticket_id AS ticketId,
  o.source_ticket_revision_id AS sourceTicketRevisionId, o.actor_id AS actorId, o.audit_log_id AS auditLogId,
  s.project_id AS snapshotProjectId, s.mapping_id AS snapshotMappingId,
  s.external_work_item_id AS snapshotItemId, s.content_json AS contentJson,
  a.before_summary_json AS auditBeforeJson, a.after_summary_json AS auditAfterJson, a.metadata_json AS auditMetadataJson,
  s.external_status AS externalStatus, s.concurrency_token AS concurrencyToken, s.captured_at AS capturedAt,
  CASE WHEN r.ticket_id = o.ticket_id AND r.project_id = o.project_id AND r.review_status = 'approved'
    AND a.project_id = o.project_id AND a.actor_id = o.actor_id AND a.actor_type = 'mcp_client'
    AND a.action = 'plane_mapping.observed' AND a.entity_type = 'plane_observation' AND a.entity_id = o.snapshot_id
    AND actor.id IS NOT NULL THEN 1 ELSE 0 END AS validScope
  FROM plane_observations o
  LEFT JOIN external_work_item_snapshots s ON s.id = o.snapshot_id
  LEFT JOIN ticket_revisions r ON r.id = o.source_ticket_revision_id
  LEFT JOIN audit_log a ON a.id = o.audit_log_id
  LEFT JOIN local_actors actor ON actor.id = o.actor_id`;
export const driftSelect = `SELECT d.id, d.project_id AS projectId, d.mapping_id AS mappingId,
  d.snapshot_id AS externalWorkItemSnapshotId, d.internal_owner_type AS ownerType, d.internal_owner_id AS ownerId,
  d.diff_json AS diffJson, d.detected_at AS detectedAt, d.resolution_decision_id AS resolutionDecisionId,
  decision.project_id AS decisionProjectId FROM content_drifts d
  LEFT JOIN external_work_item_snapshots s ON s.id = d.snapshot_id
  LEFT JOIN plane_observations o ON o.snapshot_id = d.snapshot_id
  LEFT JOIN decisions decision ON decision.id = d.resolution_decision_id`;

export function validateDrift(row: DriftRow, mapping: ExternalWorkItemMapping,
  captured: ReturnType<typeof validateObservationEvidence> | undefined): ContentDrift {
  if (!captured || row.projectId !== mapping.projectId || row.mappingId !== mapping.id ||
      row.ownerType !== "ticket" || row.ownerId !== mapping.internalOwnerId ||
      (row.resolutionDecisionId !== null && row.decisionProjectId !== mapping.projectId)) invalid(mapping.id);
  const parsed = diffSchema.safeParse(parseEvidenceJson(row.diffJson, mapping.id));
  if (!parsed.success || parsed.data.source_ticket_revision_id !== captured.provenance.sourceTicketRevisionId) invalid(mapping.id);
  const diff = parsed.data;
  let previousIndex = -1;
  const content = captured.snapshot.content as Record<string, unknown>;
  for (const change of diff.changes) {
    const index = managedFields.indexOf(change.field);
    const present = Object.hasOwn(content, change.field);
    if (index <= previousIndex || change.observed.present !== present ||
        (change.observed.present && change.observed.value !== content[change.field]) ||
        (change.observed.present && change.observed.value === change.expected)) invalid(mapping.id);
    previousIndex = index;
  }
  return { id: row.id, projectId: row.projectId, mappingId: row.mappingId,
    externalWorkItemSnapshotId: row.externalWorkItemSnapshotId, diff,
    detectedAt: row.detectedAt, resolutionDecisionId: row.resolutionDecisionId };
}

export function validateObservationEvidence(row: ObservationRow, mapping: ExternalWorkItemMapping) {
  if (row.validScope !== 1 || row.mappingId !== mapping.id || row.projectId !== mapping.projectId ||
      row.ticketId !== mapping.internalOwnerId || row.externalWorkItemId !== mapping.externalWorkItemId ||
      row.snapshotProjectId !== mapping.projectId || row.snapshotMappingId !== mapping.id ||
      row.snapshotItemId !== mapping.externalWorkItemId || row.contentJson === null || row.capturedAt === null) invalid(mapping.id);
  for (const value of [row.auditBeforeJson, row.auditAfterJson, row.auditMetadataJson]) {
    if (value !== null) parseEvidenceJson(value, mapping.id);
  }
  const content = parseEvidenceJson(row.contentJson, mapping.id);
  if (!content || typeof content !== "object" || Array.isArray(content)) invalid(mapping.id);
  const snapshot: ExternalWorkItemSnapshot = { id: row.snapshotId, projectId: row.projectId, mappingId: row.mappingId,
    externalWorkItemId: row.externalWorkItemId, content, externalStatus: row.externalStatus,
    concurrencyToken: row.concurrencyToken, capturedAt: row.capturedAt };
  const provenance: PlaneObservation = { snapshotId: row.snapshotId, projectId: row.projectId, mappingId: row.mappingId,
    externalWorkItemId: row.externalWorkItemId, ticketId: row.ticketId, sourceTicketRevisionId: row.sourceTicketRevisionId,
    actorId: row.actorId, auditLogId: row.auditLogId };
  return { snapshot, provenance };
}

export function parseEvidenceJson(value: string, mappingId: string): unknown {
  try { return JSON.parse(value) as unknown; } catch (error) { if (error instanceof SyntaxError) invalid(mappingId); throw error; }
}
export function invalid(mappingId: string): never {
  throw new ApplicationError("CONFLICT", "Plane observation evidence has inconsistent provenance.", { mappingId });
}
