import { ApplicationError } from "../../domain/errors.js";
import type { SyncIntent } from "../../domain/sync-intent.js";
import type { ClaimAuditInput, ClaimFence, SyncAttemptClaimRepository, SyncIntentClaim } from "../../application/sync-attempt-claim-ports.js";
import { canonicalizeJson } from "../../application/canonical-json.js";
import { hashJson } from "../../application/plane-export-payload.js";
import { createAuditRepositories } from "./audit-repositories.js";
import { createSyncIntentRepositories } from "./sync-intent-repositories.js";
import type { SqliteDatabase } from "./database.js";

type ClaimRow = Omit<SyncIntentClaim, "invocationStarted" | "requiresReconciliation"> & {
  invocationStartedAt: string | null; requiresReconciliation: number; releasedAt: string | null;
};
const columns = `sync_intent_id AS intentId, claim_token AS token, worker_id AS workerId,
  attempt_id AS attemptId, claimed_at AS claimedAt, expires_at AS expiresAt,
  invocation_started_at AS invocationStartedAt, invocation_kind AS invocationKind, requires_reconciliation AS requiresReconciliation,
  released_at AS releasedAt`;
const conflict = (message: string): never => { throw new ApplicationError("CONFLICT", message); };
function mapClaim(row: ClaimRow): SyncIntentClaim {
  const { invocationStartedAt, requiresReconciliation, releasedAt: _, ...claim } = row;
  return { ...claim, invocationStarted: invocationStartedAt !== null, requiresReconciliation: Boolean(requiresReconciliation) };
}
function timestamp(value: string): void {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ApplicationError("VALIDATION_ERROR", "Claim timestamps must be canonical UTC milliseconds.");
  }
}
function required(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApplicationError("VALIDATION_ERROR", "Claim identities cannot be blank.");
  }
}

export function createSyncAttemptClaimRepository(database: SqliteDatabase): SyncAttemptClaimRepository {
  const intents = createSyncIntentRepositories(database).syncIntents;
  const audits = createAuditRepositories(database).auditLog;
  const latest = (intentId: string) => database.prepare(`SELECT ${columns} FROM sync_intent_claims
    WHERE sync_intent_id = ? ORDER BY sequence DESC LIMIT 1`).get(intentId) as ClaimRow | undefined;
  const intentFor = (id: string): SyncIntent => {
    const intent = intents.findById(id);
    if (!intent) throw new ApplicationError("NOT_FOUND", "Sync Intent was not found.");
    return intent;
  };
  function audit(intent: SyncIntent, claim: SyncIntentClaim, action: string, now: string, auditId: string, metadata = {}) {
    audits.append({ id: auditId, projectId: intent.projectId, actorType: "system", actorId: null,
      action, entityType: "sync_attempt", entityId: claim.attemptId, beforeSummary: null,
      afterSummary: { syncIntentId: intent.id, attemptId: claim.attemptId, workerId: claim.workerId,
        requiresReconciliation: claim.requiresReconciliation }, metadata, createdAt: now });
  }
  function assertCurrent(input: ClaimFence): SyncIntentClaim {
    timestamp(input.now);
    const row = latest(input.intentId);
    if (!row || row.token !== input.token || row.releasedAt !== null || row.expiresAt <= input.now ||
        (row.invocationStartedAt ?? row.claimedAt) > input.now) conflict("Sync claim is expired, released, or owned by another worker.");
    const claim = mapClaim(row!);
    const intent = intentFor(input.intentId);
    if (intent.lifecycleStatus !== "active" || database.prepare(`SELECT 1 FROM sync_attempts
      WHERE sync_intent_id = ? AND result_status = 'succeeded'`).get(input.intentId)) {
      conflict("Sync Intent cannot be completed by this claim.");
    }
    if (!database.prepare("SELECT 1 FROM sync_attempts WHERE id = ? AND result_status = 'started'").get(claim.attemptId)) {
      conflict("Sync Attempt is already terminal.");
    }
    return claim;
  }
  function requireTransaction() {
    if (!database.inTransaction) throw new ApplicationError("STORAGE_ERROR", "Outcome completion requires the processor transaction.");
  }
  function terminal(input: ClaimAuditInput, result: {
    status: "failed" | "succeeded"; error: unknown; response: unknown; itemId: string | null;
    reconciledAbsent?: boolean;
  }) {
    const claim = assertCurrent(input);
    if ((result.status === "succeeded" || result.reconciledAbsent) && !claim.invocationStarted) {
      conflict("Provider outcome requires a recorded invocation.");
    }
    database.prepare(`UPDATE sync_attempts SET completed_at = ?, result_status = ?, response_json = ?,
      error_json = ?, external_work_item_id = ? WHERE id = ? AND result_status = 'started'`).run(
      input.now, result.status, result.response === null ? null : canonicalizeJson(result.response),
      result.error === null ? null : canonicalizeJson(result.error), result.itemId, claim.attemptId);
    database.prepare(`UPDATE sync_intent_claims SET released_at = ?, requires_reconciliation = ?
      WHERE claim_token = ?`).run(input.now, result.reconciledAbsent ? 0 : Number(claim.requiresReconciliation), input.token);
    audit(intentFor(input.intentId), { ...claim, requiresReconciliation: result.reconciledAbsent ? false : claim.requiresReconciliation },
      result.reconciledAbsent ? "sync_attempt.reconciled_absent" : `sync_attempt.${result.status}`,
      input.now, input.auditId, { error: result.error, externalWorkItemId: result.itemId });
  }
  return {
    claim(input) {
      timestamp(input.now); timestamp(input.expiresAt);
      [input.intentId, input.token, input.workerId, input.attemptId, input.auditId].forEach(required);
      if (input.expiresAt <= input.now) throw new ApplicationError("VALIDATION_ERROR", "Claim expiry must be later than its start.");
      // BEGIN IMMEDIATE 先取得寫入鎖，避免兩個 connections 同時讀到沒有有效 claim。
      return database.transaction(() => {
        const intent = intentFor(input.intentId);
        const owner = intent.payload.owner as { type?: unknown; id?: unknown } | undefined;
        const eligible = database.prepare(`SELECT 1 FROM ticket_revisions r JOIN tickets t ON t.id = r.ticket_id
          JOIN external_containers c ON c.id = ? WHERE r.id = ? AND r.project_id = ?
          AND t.project_id = r.project_id AND t.id = ? AND c.provider = 'plane'`).get(
          intent.externalContainerId, intent.sourceTicketRevisionId, intent.projectId, typeof owner?.id === "string" ? owner.id : null);
        if (intent.lifecycleStatus !== "active" || intent.operation !== "create" || intent.mappingId !== null ||
            intent.sequenceNumber !== null || intent.sourceEventType !== "plane_ticket_export_requested" ||
            owner?.type !== "ticket" || intent.payload.schema_version !== 1 ||
            intent.payload.source_ticket_revision_id !== intent.sourceTicketRevisionId ||
            hashJson(intent.payload) !== intent.payloadHash || !eligible) conflict("Intent is not an active Plane manual create request.");
        if (intents.listAttempts(intent.id).some(attempt => attempt.resultStatus === "succeeded")) {
          conflict("Sync Intent has already succeeded.");
        }
        const previous = latest(intent.id);
        if (previous && (previous.claimedAt > input.now || (previous.releasedAt !== null && previous.releasedAt > input.now))) {
          conflict("Claim clock cannot move backwards.");
        }
        if (previous && previous.releasedAt === null && previous.expiresAt > input.now) {
          conflict("Sync Intent is already leased by a worker.");
        }
        // 沒有 claim 的既有 attempts 無法證明未送出，採保守 reconciliation。
        let requiresReconciliation = previous ? Boolean(previous.requiresReconciliation) : intents.listAttempts(intent.id).length > 0;
        const interrupted = intents.listAttempts(intent.id).filter(attempt => attempt.resultStatus === "started");
        for (const attempt of interrupted) {
          const uncertain = previous?.attemptId === attempt.id ?
            previous.invocationStartedAt !== null || Boolean(previous.requiresReconciliation) : true;
          requiresReconciliation ||= uncertain;
          database.prepare(`UPDATE sync_attempts SET completed_at = ?, result_status = 'failed', error_json = ? WHERE id = ?`).run(
            input.now, canonicalizeJson({ code: "INTERRUPTED", outcome_uncertain: uncertain,
              invocation_started: previous?.attemptId === attempt.id ? previous.invocationStartedAt !== null : null }), attempt.id);
        }
        if (previous?.releasedAt === null) database.prepare("UPDATE sync_intent_claims SET released_at = ? WHERE claim_token = ?").run(input.now, previous.token);
        database.prepare(`INSERT INTO sync_attempts (id, sync_intent_id, operation, idempotency_key, started_at, result_status)
          VALUES (?, ?, ?, ?, ?, 'started')`).run(input.attemptId, intent.id, intent.operation, intent.idempotencyKey, input.now);
        database.prepare(`INSERT INTO sync_intent_claims (sync_intent_id, claim_token, worker_id, attempt_id,
          claimed_at, expires_at, requires_reconciliation) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          intent.id, input.token, input.workerId, input.attemptId, input.now, input.expiresAt, Number(requiresReconciliation));
        const claim = mapClaim(latest(intent.id)!);
        audit(intent, claim, "sync_attempt.claimed", input.now, input.auditId,
          { interruptedAttemptIds: interrupted.map(attempt => attempt.id), expiresAt: input.expiresAt });
        return { syncIntent: intent, claim };
      }).immediate();
    },
    assertCurrent,
    markInvoking(input) {
      return database.transaction(() => {
        const claim = assertCurrent(input);
        if (claim.invocationStarted) conflict("This attempt already recorded its provider invocation.");
        database.prepare(`UPDATE sync_intent_claims SET invocation_started_at = ?, invocation_kind = ?, requires_reconciliation = 1
          WHERE claim_token = ?`).run(input.now, claim.requiresReconciliation ? "reconcile" : "create", input.token);
        const invoking: SyncIntentClaim = { ...claim, invocationStarted: true, requiresReconciliation: true,
          invocationKind: claim.requiresReconciliation ? "reconcile" : "create" };
        audit(intentFor(input.intentId), invoking, "sync_attempt.invoking", input.now, input.auditId);
        return invoking;
      }).immediate();
    },
    completeFailure(input) {
      database.transaction(() => terminal(input, { status: "failed", error: input.error, response: null, itemId: null })).immediate();
    },
    completeSuccess(input) {
      requireTransaction();
      const intent = intentFor(input.intentId);
      const owner = intent.payload.owner as { id?: unknown };
      const persisted = database.prepare(`SELECT 1 FROM external_work_items w
        JOIN external_work_item_mappings m ON m.external_work_item_id = w.id
        JOIN external_work_item_snapshots s ON s.external_work_item_id = w.id AND s.mapping_id = m.id
        WHERE w.id = ? AND w.provider = 'plane' AND w.external_container_id = ? AND w.lifecycle_status = 'active'
          AND m.project_id = ? AND m.internal_owner_type = 'ticket' AND m.internal_owner_id = ?
          AND m.external_container_id = w.external_container_id AND m.lifecycle_status = 'active'
          AND m.source_ticket_revision_id = ? AND s.project_id = m.project_id`).get(
          input.externalWorkItemId, intent.externalContainerId, intent.projectId, owner.id, intent.sourceTicketRevisionId);
      if (!persisted) conflict("Successful create must persist a matching item, mapping, and snapshot in the processor transaction.");
      terminal(input, { status: "succeeded", error: null, response: input.response, itemId: input.externalWorkItemId });
    },
    completeReconciledAbsent(input) {
      requireTransaction();
      const claim = assertCurrent(input);
      if (claim.invocationKind !== "reconcile") conflict("Reconciled absence requires a reconciliation invocation.");
      terminal(input, { status: "failed", error: { code: "RECONCILED_ABSENT", outcome_uncertain: false },
        response: input.response, itemId: null, reconciledAbsent: true });
    }
  };
}
