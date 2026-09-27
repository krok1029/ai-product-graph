import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import { ApplicationError } from "../domain/errors.js";
import { normalizeRequiredString } from "./implementation-workflow-helpers.js";
import type { SyncAttemptClaimRepository } from "./sync-attempt-claim-ports.js";

export type SyncAttemptClaimsOptions = {
  clock?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
};

export class SyncAttemptClaims {
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;

  constructor(private readonly repository: SyncAttemptClaimRepository, options: SyncAttemptClaimsOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? ulid;
    this.tokenFactory = options.tokenFactory ?? randomUUID;
  }

  claim(intentId: string, workerId: string, leaseDurationMs: number) {
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new ApplicationError("VALIDATION_ERROR", "Lease duration must be a positive integer in milliseconds.");
    }
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + leaseDurationMs);
    if (!Number.isFinite(now.getTime()) || !Number.isFinite(expiresAt.getTime())) {
      throw new ApplicationError("VALIDATION_ERROR", "Claim clock and expiry must be valid dates.");
    }
    return this.repository.claim({ intentId: normalizeRequiredString(intentId, "sync_intent_id"),
      workerId: normalizeRequiredString(workerId, "worker_id"), token: this.tokenFactory(),
      attemptId: this.idFactory(), auditId: this.idFactory(), now: now.toISOString(), expiresAt: expiresAt.toISOString() });
  }

  markInvoking(intentId: string, token: string) {
    return this.repository.markInvoking({ intentId, token, now: this.clock().toISOString(), auditId: this.idFactory() });
  }

  fail(intentId: string, token: string, error: Record<string, unknown>) {
    this.repository.completeFailure({ intentId, token, error, now: this.clock().toISOString(), auditId: this.idFactory() });
  }
}
