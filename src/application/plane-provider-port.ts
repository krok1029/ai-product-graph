import type { ExternalContainer } from "../domain/external-container.js";

// Provider port 不帶 REST DTO／credentials；每次呼叫對應一筆 durable Sync Attempt。
export type PlaneCreateRequest = {
  container: ExternalContainer;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  payloadHash: string;
};

export type PlaneItemObservation = {
  externalId: string;
  externalUrl: string | null;
  content: Record<string, unknown>;
  externalStatus: string | null;
  concurrencyToken: string | null;
};

export type PlaneCreateOutcome =
  | { status: "succeeded"; item: PlaneItemObservation }
  | { status: "failed"; error: Record<string, unknown> }
  | { status: "unknown"; error: Record<string, unknown> };

export type PlaneReconcileOutcome =
  | { status: "found"; item: PlaneItemObservation }
  // Adapter 必須保證沒有晚到的舊 create；普通 404 不足以滿足此契約。
  | { status: "definitely_absent"; evidence: Record<string, unknown> }
  | { status: "unknown"; error: Record<string, unknown> };

export interface PlaneProviderPort {
  create(request: PlaneCreateRequest): Promise<PlaneCreateOutcome>;
  reconcile(request: PlaneCreateRequest): Promise<PlaneReconcileOutcome>;
}
