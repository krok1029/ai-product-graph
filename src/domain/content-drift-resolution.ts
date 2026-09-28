// Content Drift 的不可變處置關係；拒絕與採用共用此契約。
import type { ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "./external-work-item.js";
import type { ContentDrift, PlaneObservation } from "./plane-observation.js";
import type { TicketRevision } from "./models.js";
import type { Decision } from "./result-acceptance.js";

type ResolutionIdentity = {
  id: string; projectId: string; contentDriftId: string; decisionId: string; auditLogId: string;
};
export type ContentDriftResolution = ResolutionIdentity & (
  { kind: "reject"; draftTicketRevisionId: null } | { kind: "adopt"; draftTicketRevisionId: string }
);
export type ContentDriftEvidence = {
  mapping: ExternalWorkItemMapping; drift: ContentDrift; snapshot: ExternalWorkItemSnapshot; observation: PlaneObservation;
};
export type ContentDriftResolutionDetails = {
  record: ContentDriftResolution; decision: Decision; draft: TicketRevision | null;
};
export type ContentDriftResolutionView = {
  evidence: ContentDriftEvidence; resolution: ContentDriftResolutionDetails | null;
};
