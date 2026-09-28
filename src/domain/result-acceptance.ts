import type { DeliveryStatus } from "./models.js";

export type ResultAcceptance = {
  id: string;
  projectId: string;
  implementationResultId: string;
  actorId: string;
  acceptedAt: string;
};

export type Decision = {
  id: string;
  projectId: string;
  decisionType: "acceptance_criterion_waiver" | "result_acceptance_revocation" | "sync_mapping_termination" | "content_drift_rejection" | "content_drift_adoption";
  summary: string;
  actorId: string;
  createdAt: string;
};

export type ResultAcceptanceCriterionOutcome = {
  id: string;
  resultAcceptanceId: string;
  acceptanceCriterionId: string;
  submittedVerdictId: string;
  outcome: "satisfied" | "waived";
  waiverDecisionId: string | null;
  createdAt: string;
};

export type OperationReceipt = {
  id: string;
  projectId: string;
  localActorId: string;
  operationName: "accept_implementation_result" | "revoke_result_acceptance";
  idempotencyKey: string;
  normalizedCommandHash: string;
  normalizedCommandJson: string;
  responseJson: string;
  responseAuditLogId: string | null;
  resultAcceptanceId: string | null;
  resultRevocationId: string | null;
  createdAt: string;
};

export type ResultRevocation = {
  id: string;
  projectId: string;
  resultAcceptanceId: string;
  decisionId: string;
  previousDeliveryStatus: DeliveryStatus;
  resultingDeliveryStatus: DeliveryStatus;
};
