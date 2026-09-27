import type { SyncIntent } from "../domain/sync-intent.js";

export type SyncIntentClaim = {
  intentId: string;
  token: string;
  workerId: string;
  attemptId: string;
  claimedAt: string;
  expiresAt: string;
  invocationStarted: boolean;
  invocationKind: "create" | "reconcile" | null;
  requiresReconciliation: boolean;
};
export type ClaimedSyncIntent = { syncIntent: SyncIntent; claim: SyncIntentClaim };
export type ClaimFence = { intentId: string; token: string; now: string };
export type ClaimAuditInput = ClaimFence & { auditId: string };
export type ClaimInput = {
  intentId: string; workerId: string; token: string; attemptId: string;
  now: string; expiresAt: string; auditId: string;
};

export interface SyncAttemptClaimRepository {
  claim(input: ClaimInput): ClaimedSyncIntent;
  markInvoking(input: ClaimAuditInput): SyncIntentClaim;
  completeFailure(input: ClaimAuditInput & { error: Record<string, unknown> }): void;
  assertCurrent(input: ClaimFence): SyncIntentClaim;
  // Processor 必須在同一 transaction 寫入 item、mapping、snapshot 與相關 audit。
  completeSuccess(input: ClaimAuditInput & {
    externalWorkItemId: string; response: Record<string, unknown>;
  }): void;
  // 只有 provider 確認不存在且舊請求不會延遲生效時，才能解除不確定性。
  completeReconciledAbsent(input: ClaimAuditInput & { response: Record<string, unknown> }): void;
}
