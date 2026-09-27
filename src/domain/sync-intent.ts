import type { LifecycleStatus } from "./models.js";

export type SyncIntent = {
  id: string;
  projectId: string;
  mappingId: string | null;
  externalContainerId: string | null;
  sequenceNumber: number | null;
  operation: string;
  sourceEventType: string;
  sourceEventId: string;
  sourceTicketRevisionId: string | null;
  payloadHash: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  supersedesSyncIntentId: string | null;
  lifecycleStatus: LifecycleStatus;
  createdAt: string;
};

export type SyncAttempt = {
  id: string;
  syncIntentId: string;
  externalWorkItemId: string | null;
  operation: string;
  idempotencyKey: string;
  startedAt: string;
  completedAt: string | null;
  resultStatus: "started" | "succeeded" | "failed";
  response: unknown | null;
  error: unknown | null;
};

export type SyncIntentRequestState = "pending" | "running" | "succeeded" | "failed" | "archived";

export type SyncIntentDetails = {
  syncIntent: SyncIntent;
  attempts: SyncAttempt[];
  requestState: SyncIntentRequestState;
};
