import { z } from "zod";
import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { SyncIntentDetails } from "../domain/sync-intent.js";
import { hashJson } from "./plane-export-payload.js";

const nonempty = z.string().trim().min(1);
const contentSchema = z.object({
  title: nonempty, user_story: nonempty, scope: z.array(nonempty),
  acceptance_criteria: z.array(z.object({ id: nonempty, text: nonempty })).min(1),
  non_goals: z.array(nonempty), implementation_notes: z.array(nonempty).optional()
});

// Pure evaluator 也驗證輸入，避免非 repository 呼叫者把損壞的 history 算成 current。
export function validHealthObligation(details: SyncIntentDetails, mapping: ExternalWorkItemMapping,
  originalCreate: boolean): boolean {
  const intent = details.syncIntent;
  const payload = intent.payload;
  const owner = record(payload.owner);
  if (!nonempty.safeParse(intent.id).success || !nonempty.safeParse(intent.idempotencyKey).success ||
      !nonempty.safeParse(intent.sourceEventId).success || intent.projectId !== mapping.projectId ||
      intent.externalContainerId !== mapping.externalContainerId || !intent.sourceTicketRevisionId ||
      payload.schema_version !== 1 || owner?.type !== "ticket" || owner.id !== mapping.internalOwnerId ||
      payload.source_ticket_revision_id !== intent.sourceTicketRevisionId ||
      !["create", "update", "close", "reopen"].includes(intent.operation)) return false;
  try {
    if (hashJson(payload) !== intent.payloadHash) return false;
  } catch { return false; }
  if (originalCreate) {
    if (intent.operation !== "create" || intent.mappingId !== null || intent.sequenceNumber !== null ||
        intent.sourceEventType !== "plane_ticket_export_requested" || intent.supersedesSyncIntentId !== null ||
        intent.sourceTicketRevisionId !== mapping.sourceTicketRevisionId ||
        record(mapping.metadata)?.created_by_sync_intent_id !== intent.id) return false;
  } else if (intent.mappingId !== mapping.id || !Number.isSafeInteger(intent.sequenceNumber) ||
      intent.sequenceNumber! < 1 || !Number.isSafeInteger(mapping.nextSequenceNumber) ||
      intent.sequenceNumber! >= mapping.nextSequenceNumber) return false;

  if (intent.operation === "create" || intent.operation === "update") {
    const parsed = contentSchema.safeParse(payload.specification);
    if (!parsed.success || new Set(parsed.data.acceptance_criteria.map(item => item.id)).size !==
        parsed.data.acceptance_criteria.length) return false;
  } else if (intent.operation === "close" ? payload.delivery_status !== "done" :
    !["planned", "in_progress", "blocked"].includes(payload.delivery_status as string)) return false;

  const attemptIds = new Set<string>();
  let priorStartedAt = "";
  for (const attempt of details.attempts) {
    if (attemptIds.has(attempt.id) || !attempt.id || attempt.syncIntentId !== intent.id ||
        attempt.idempotencyKey !== intent.idempotencyKey || attempt.operation !== intent.operation ||
        (attempt.externalWorkItemId !== null && attempt.externalWorkItemId !== mapping.externalWorkItemId) ||
        !["started", "failed", "succeeded"].includes(attempt.resultStatus) ||
        !Number.isFinite(Date.parse(attempt.startedAt)) || attempt.startedAt < priorStartedAt ||
        (attempt.resultStatus === "started" ? attempt.completedAt !== null :
          !attempt.completedAt || !Number.isFinite(Date.parse(attempt.completedAt)) || attempt.completedAt < attempt.startedAt) ||
        (attempt.resultStatus === "succeeded" && attempt.externalWorkItemId !== mapping.externalWorkItemId)) return false;
    attemptIds.add(attempt.id);
    priorStartedAt = attempt.startedAt;
  }
  if (originalCreate && !details.attempts.some(attempt => attempt.resultStatus === "succeeded" &&
      record(attempt.response)?.mapping_id === mapping.id &&
      nonempty.safeParse(record(attempt.response)?.snapshot_id).success)) return false;
  return true;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
