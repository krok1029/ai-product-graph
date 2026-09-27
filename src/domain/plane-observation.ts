export type PlaneManagedField = "name" | "description_html" | "external_source" | "external_id";

export type ManagedFieldChange = {
  field: PlaneManagedField;
  expected: string;
  observed: { present: false } | { present: true; value: string | null };
};

export type ContentDriftDiff = {
  schema_version: 1;
  source_ticket_revision_id: string;
  changes: ManagedFieldChange[];
};

export type PlaneObservation = {
  snapshotId: string;
  projectId: string;
  mappingId: string;
  externalWorkItemId: string;
  ticketId: string;
  sourceTicketRevisionId: string;
  actorId: string;
  auditLogId: string;
};

export type ContentDrift = {
  id: string;
  projectId: string;
  mappingId: string;
  externalWorkItemSnapshotId: string;
  diff: ContentDriftDiff;
  detectedAt: string;
  resolutionDecisionId: string | null;
};
