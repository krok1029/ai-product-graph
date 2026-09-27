import type { ExternalContainer } from "../domain/external-container.js";
import type { ExternalWorkItemSnapshot } from "../domain/external-work-item.js";
import type { ContentDrift, ManagedFieldChange, PlaneObservation } from "../domain/plane-observation.js";
import type { PlaneCreateRequest, PlaneItemObservation } from "./plane-provider-port.js";

export type { ManagedFieldChange, PlaneManagedField, ContentDriftDiff } from "../domain/plane-observation.js";

export type PlaneReadRequest = { container: ExternalContainer; externalId: string };
export type PlaneReadOutcome =
  | { status: "observed"; item: PlaneItemObservation }
  | { status: "unknown"; error: { code: string; http_status?: number } };

export interface PlaneObservationProviderPort {
  readKnownItem(request: PlaneReadRequest): Promise<PlaneReadOutcome>;
}

export interface PlaneManagedContentPort {
  // 純同步比較可在本機 commit transaction 內執行，不得呼叫外部服務。
  compare(input: { expected: PlaneCreateRequest; observed: PlaneItemObservation }): ManagedFieldChange[];
}

export type PlaneObserveResult = {
  status: "captured";
  mappingId: string;
  snapshotId: string;
  sourceTicketRevisionId: string;
  contentDriftId: string | null;
  auditLogId: string;
};
export type PlaneObserveOutcome = PlaneObserveResult | Extract<PlaneReadOutcome, { status: "unknown" }>;

export interface PlaneObservationWriteRepository {
  insertCapture(input: {
    snapshot: ExternalWorkItemSnapshot;
    observation: PlaneObservation;
    drift: ContentDrift | null;
  }): void;
}
