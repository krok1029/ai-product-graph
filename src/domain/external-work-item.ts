import type { LifecycleStatus } from "./models.js";

export type ExternalWorkItem = {
  id: string;
  externalContainerId: string;
  provider: "plane";
  externalId: string;
  externalUrl: string | null;
  lifecycleStatus: LifecycleStatus;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ExternalWorkItemMapping = {
  id: string;
  projectId: string;
  internalOwnerType: "ticket";
  internalOwnerId: string;
  externalContainerId: string;
  externalWorkItemId: string;
  sourceTicketRevisionId: string | null;
  lifecycleStatus: LifecycleStatus;
  nextSequenceNumber: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ExternalWorkItemSnapshot = {
  id: string;
  projectId: string;
  externalWorkItemId: string;
  mappingId: string | null;
  content: unknown;
  externalStatus: string | null;
  concurrencyToken: string | null;
  capturedAt: string;
};

export type TicketExternalWorkItem = {
  mapping: ExternalWorkItemMapping;
  externalWorkItem: ExternalWorkItem;
  snapshots: ExternalWorkItemSnapshot[];
};

export type ExternalWorkItemDetails = {
  externalWorkItem: ExternalWorkItem;
  mappings: ExternalWorkItemMapping[];
  snapshots: ExternalWorkItemSnapshot[];
};
