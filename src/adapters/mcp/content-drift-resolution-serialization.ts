// 指定 drift 的公用處置 DTO；來源證據與處置決策分開，draft 狀態不等同 resolution 種類。
import type { ContentDriftResolutionView } from "../../domain/content-drift-resolution.js";
import { serializeTicketRevision } from "./serializers.js";

export function serializeContentDriftResolution({ evidence, resolution }: ContentDriftResolutionView) {
  return {
    content_drift_id: evidence.drift.id,
    evidence: { mapping_id: evidence.mapping.id, ticket_id: evidence.mapping.internalOwnerId,
      snapshot_id: evidence.snapshot.id, captured_source_ticket_revision_id: evidence.observation.sourceTicketRevisionId },
    resolution: resolution === null ? null : {
      record: { id: resolution.record.id, project_id: resolution.record.projectId,
        content_drift_id: resolution.record.contentDriftId, decision_id: resolution.record.decisionId,
        kind: resolution.record.kind, draft_ticket_revision_id: resolution.record.draftTicketRevisionId,
        audit_log_id: resolution.record.auditLogId },
      decision: { id: resolution.decision.id, project_id: resolution.decision.projectId,
        decision_type: resolution.decision.decisionType, summary: resolution.decision.summary,
        actor_id: resolution.decision.actorId, created_at: resolution.decision.createdAt },
      draft: resolution.draft === null ? null : serializeTicketRevision(resolution.draft)
    }
  };
}
