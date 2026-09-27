import { ulid } from "ulid";
import { ApplicationError } from "../domain/errors.js";
import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { SyncIntent } from "../domain/sync-intent.js";
import type { ApplicationPorts } from "./ports.js";
import { SyncAttemptClaims, type SyncAttemptClaimsOptions } from "./sync-attempt-claims.js";
import type { PlaneCreateRequest, PlaneItemObservation, PlaneProviderPort } from "./plane-provider-port.js";
import { hashJson } from "./plane-export-payload.js";
import { createdExternalProjection, insertExternalItemGraphProjection } from "./external-item-projection.js";

export interface PlaneMappingEnrollmentPort {
  // 與 mapping 建立同一 transaction，補入當前 desired revision/status 的 intents。
  onCreated(input: { intent: SyncIntent; mapping: ExternalWorkItemMapping; now: string }): void;
}

export class PlaneCreateProcessor {
  private readonly claims: SyncAttemptClaims;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly ports: ApplicationPorts, private readonly provider: PlaneProviderPort,
    private readonly enrollment: PlaneMappingEnrollmentPort, options: SyncAttemptClaimsOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? ulid;
    this.claims = new SyncAttemptClaims(ports.syncClaims, options);
  }

  async process(intentId: string, workerId: string, leaseDurationMs = 60_000) {
    const intent = this.ports.syncIntents.findById(intentId);
    if (!intent) throw new ApplicationError("NOT_FOUND", "Sync Intent was not found.");
    const request = this.requireRequest(intent);
    const success = this.ports.syncIntents.listAttempts(intentId).find(attempt => attempt.resultStatus === "succeeded");
    if (success) {
      if (!success.externalWorkItemId) throw new ApplicationError("CONFLICT", "Successful create is missing its external item.");
      return { status: "already_succeeded" as const, externalWorkItemId: success.externalWorkItemId, attemptId: success.id };
    }
    const { claim } = this.claims.claim(intentId, workerId, leaseDurationMs);
    this.claims.markInvoking(intentId, claim.token);

    // 此處已離開 claim transaction；一次 process 最多執行一次 provider invocation。
    let outcome;
    try {
      outcome = claim.requiresReconciliation
        ? await this.provider.reconcile(request)
        : await this.provider.create(request);
    } catch {
      // 不保存可能含 credentials 的 exception text；不能假設 throw 代表外部沒有成功。
      this.claims.fail(intentId, claim.token, { code: "PROVIDER_OUTCOME_UNKNOWN" });
      return { status: "failed" as const, attemptId: claim.attemptId };
    }
    if (outcome.status === "unknown" || outcome.status === "failed") {
      this.claims.fail(intentId, claim.token, outcome.error);
      return { status: "failed" as const, attemptId: claim.attemptId };
    }
    if (outcome.status === "definitely_absent") {
      this.ports.transactions.run(() => this.ports.syncClaims.completeReconciledAbsent({
        intentId, token: claim.token, now: this.clock().toISOString(), auditId: this.idFactory(),
        response: outcome.evidence
      }));
      return { status: "reconciled_absent" as const, attemptId: claim.attemptId };
    }
    try {
      validateObservation(outcome.item);
    } catch {
      this.claims.fail(intentId, claim.token, { code: "INVALID_PROVIDER_OBSERVATION" });
      return { status: "failed" as const, attemptId: claim.attemptId };
    }
    // 本機 commit 失敗時保留 invocation started；恢復必須 reconcile，不能重做 create。
    return this.ports.transactions.run(() => {
      const now = this.clock().toISOString();
      this.ports.syncClaims.assertCurrent({ intentId, token: claim.token, now });
      const ownerId = (intent.payload.owner as { id: string }).id;
      const projection = createdExternalProjection(intent, ownerId, outcome.item, now, this.idFactory);
      this.ports.externalWorkItemWrites.insertCreatedProjection(projection);
      const specification = intent.payload.specification as { title: string };
      insertExternalItemGraphProjection(this.ports, projection, specification.title, this.idFactory());
      this.enrollment.onCreated({ intent, mapping: projection.mapping, now });
      this.ports.syncClaims.completeSuccess({ intentId, token: claim.token, now, auditId: this.idFactory(),
        externalWorkItemId: projection.externalWorkItem.id,
        response: { external_id: outcome.item.externalId, mapping_id: projection.mapping.id,
          snapshot_id: projection.snapshot.id } });
      this.ports.auditLog.append({ id: this.idFactory(), projectId: intent.projectId, actorType: "system",
        actorId: null, action: "plane_ticket_export.completed", entityType: "external_work_item",
        entityId: projection.externalWorkItem.id, beforeSummary: null,
        afterSummary: { syncIntentId: intentId, mappingId: projection.mapping.id, snapshotId: projection.snapshot.id },
        metadata: { worker_id: workerId, attempt_id: claim.attemptId }, createdAt: now });
      return { status: "succeeded" as const, externalWorkItemId: projection.externalWorkItem.id, attemptId: claim.attemptId };
    });
  }

  private requireRequest(intent: SyncIntent): PlaneCreateRequest {
    const owner = intent.payload.owner as { type?: unknown; id?: unknown } | undefined;
    const specification = intent.payload.specification as { title?: unknown } | undefined;
    const revision = intent.sourceTicketRevisionId ? this.ports.ticketRevisions.findById(intent.sourceTicketRevisionId) : null;
    const container = intent.externalContainerId ? this.ports.externalContainers.findById(intent.externalContainerId) : null;
    if (intent.lifecycleStatus !== "active" || intent.operation !== "create" ||
        intent.sourceEventType !== "plane_ticket_export_requested" || intent.mappingId !== null ||
        intent.payload.schema_version !== 1 || owner?.type !== "ticket" || typeof owner.id !== "string" ||
        !revision || revision.ticketId !== owner.id || revision.projectId !== intent.projectId ||
        intent.payload.source_ticket_revision_id !== revision.id || typeof specification?.title !== "string" ||
        !container || container.provider !== "plane" || hashJson(intent.payload) !== intent.payloadHash) {
      throw new ApplicationError("CONFLICT", "Intent is not a valid pinned Plane first-export request.");
    }
    return { container, idempotencyKey: intent.idempotencyKey, payload: intent.payload, payloadHash: intent.payloadHash };
  }
}

function validateObservation(item: PlaneItemObservation) {
  if (!item || typeof item.externalId !== "string" || !item.externalId.trim() ||
      (item.externalUrl !== null && typeof item.externalUrl !== "string") ||
      (item.externalStatus !== null && typeof item.externalStatus !== "string") ||
      (item.concurrencyToken !== null && typeof item.concurrencyToken !== "string") ||
      !item.content || typeof item.content !== "object" || Array.isArray(item.content)) {
    throw new ApplicationError("VALIDATION_ERROR", "Provider returned an invalid item observation.");
  }
  hashJson(item.content);
}
