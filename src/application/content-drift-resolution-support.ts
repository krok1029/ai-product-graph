// 共用歷史處置查詢；可放在 caller transaction 內，不取得時鐘、不建立 actor 或寫入資料。
import type { ContentDriftResolutionView } from "../domain/content-drift-resolution.js";
import { ApplicationError } from "../domain/errors.js";
import type { ApplicationPorts } from "./ports.js";

export function readContentDriftResolution(ports: ApplicationPorts, contentDriftId: string): ContentDriftResolutionView {
  const evidence = ports.planeObservationReads.readDrift(contentDriftId);
  if (!evidence) throw new ApplicationError("NOT_FOUND", "Content Drift was not found.", { content_drift_id: contentDriftId });
  const resolution = ports.contentDriftResolutions.findByDriftId(contentDriftId);
  const rawReference = evidence.drift.resolutionDecisionId;
  if (!resolution) {
    if (rawReference !== null) invalid(contentDriftId);
    return { evidence, resolution: null };
  }
  const { record, decision, draft } = resolution;
  if (record.contentDriftId !== evidence.drift.id || record.projectId !== evidence.drift.projectId ||
      record.decisionId !== decision.id || decision.projectId !== record.projectId ||
      !decision.summary.trim() || decision.summary !== decision.summary.trim() ||
      (rawReference !== null && rawReference !== decision.id)) invalid(contentDriftId);
  if (record.kind === "reject") {
    if (record.draftTicketRevisionId !== null || draft !== null || decision.decisionType !== "content_drift_rejection") invalid(contentDriftId);
  } else if (record.kind === "adopt") {
    if (!draft || record.draftTicketRevisionId !== draft.id || decision.decisionType !== "content_drift_adoption" ||
        draft.projectId !== record.projectId || draft.ticketId !== evidence.mapping.internalOwnerId ||
        draft.createdAt !== decision.createdAt || !draft.baseApprovedRevisionId) invalid(contentDriftId);
    let base, graph;
    try {
      base = ports.ticketRevisions.findById(draft.baseApprovedRevisionId);
      graph = ports.graphRevisions.findById(draft.sourceGraphRevisionId);
    } catch (error) { if (error instanceof SyntaxError) invalid(contentDriftId); throw error; }
    if (!base || base.projectId !== draft.projectId || base.ticketId !== draft.ticketId || base.reviewStatus !== "approved" ||
        !graph || graph.projectId !== draft.projectId) invalid(contentDriftId);
  } else invalid(contentDriftId);
  return { evidence, resolution };
}
function invalid(contentDriftId: string): never {
  throw new ApplicationError("CONFLICT", "Content Drift resolution has inconsistent provenance.", { content_drift_id: contentDriftId });
}
