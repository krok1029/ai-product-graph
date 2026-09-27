import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { Ticket } from "../domain/models.js";
import type { SyncIntentDetails } from "../domain/sync-intent.js";
import type { MappingSyncHealth, SyncHealth } from "../domain/sync-health.js";
import { validHealthObligation } from "./sync-health-validation.js";

export type MappingSyncHealthInput = {
  mapping: ExternalWorkItemMapping;
  ticket: Pick<Ticket, "id" | "currentApprovedRevisionId" | "deliveryStatus">;
  createRequest: SyncIntentDetails | null;
  intents: SyncIntentDetails[];
};

// 只解釋 durable history；不修改 attempts、supersession 或已核准的 domain state。
export function deriveMappingSyncHealth(input: MappingSyncHealthInput): MappingSyncHealth {
  const { mapping, ticket, createRequest } = input;
  const result: MappingSyncHealth = { syncHealth: "current", included: mapping.lifecycleStatus === "active",
    requiredIntentIds: [], ignoredContentIntentIds: [], reasons: [] };
  if (!result.included) {
    result.reasons.push({ code: "mapping_archived" });
    return result;
  }
  const pending = (code: string, intentId?: string) => {
    if (result.syncHealth !== "failed") result.syncHealth = "pending";
    result.reasons.push(intentId ? { code, intentId } : { code });
  };
  if (mapping.internalOwnerId !== ticket.id || !ticket.currentApprovedRevisionId) pending("incomplete_history");
  const valid: SyncIntentDetails[] = [];
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const details of [ ...(createRequest ? [createRequest] : []), ...input.intents ]) {
    const intent = details.syncIntent;
    const original = details === createRequest;
    const sequence = intent.sequenceNumber;
    if (ids.has(intent.id) || (!original && sequences.has(sequence!)) ||
        !validHealthObligation(details, mapping, original)) {
      pending("invalid_obligation", intent.id);
      continue;
    }
    ids.add(intent.id);
    if (!original) sequences.add(sequence!);
    valid.push(details);
  }
  const original = valid.find(details => details === createRequest);
  if (!original) pending("incomplete_history");
  const mapped = valid.filter(details => details !== createRequest)
    .sort((a, b) => a.syncIntent.sequenceNumber! - b.syncIntent.sequenceNumber!);
  if (!Number.isSafeInteger(mapping.nextSequenceNumber) || mapping.nextSequenceNumber < 1 ||
      mapped.length !== mapping.nextSequenceNumber - 1) pending("incomplete_history");
  const desired = mapped.filter(details => details.syncIntent.operation === "update" &&
    details.syncIntent.sourceTicketRevisionId === ticket.currentApprovedRevisionId).at(-1);
  if (!desired && (!original || original.syncIntent.sourceTicketRevisionId !== ticket.currentApprovedRevisionId)) {
    pending("missing_current_content_intent");
  }

  const superseded = supersededContentIds(mapped, desired, pending);
  for (const details of valid) {
    const intent = details.syncIntent;
    const state = obligationState(details);
    const olderContent = intent.operation === "update" && desired &&
      intent.sequenceNumber! < desired.syncIntent.sequenceNumber!;
    if (olderContent && state === "failed") {
      result.ignoredContentIntentIds.push(intent.id);
      result.reasons.push({ code: "obsolete_failed_content", intentId: intent.id });
      continue;
    }
    if (olderContent && details.attempts.length === 0 && superseded.has(intent.id)) {
      result.ignoredContentIntentIds.push(intent.id);
      result.reasons.push({ code: "superseded_unstarted_content", intentId: intent.id });
      continue;
    }
    result.requiredIntentIds.push(intent.id);
    if (state === "failed") {
      result.syncHealth = "failed";
      result.reasons.push({ code: "intent_failed", intentId: intent.id });
    } else if (state === "pending") pending("intent_pending", intent.id);
  }

  // Opaque external status 無法替代已承諾的 close/reopen；缺少 catch-up 也必須可見。
  const latestStatus = mapped.filter(details => ["close", "reopen"].includes(details.syncIntent.operation)).at(-1);
  if (ticket.deliveryStatus === "done" && latestStatus?.syncIntent.operation !== "close") pending("missing_close_intent");
  if (ticket.deliveryStatus !== "done" && latestStatus?.syncIntent.operation === "close") pending("missing_reopen_intent");
  if (result.reasons.length === 0) result.reasons.push({ code: "obligations_fulfilled" });
  return result;
}

function obligationState(details: SyncIntentDetails): SyncHealth {
  if (details.attempts.some(attempt => attempt.resultStatus === "succeeded")) return "current";
  return details.attempts.at(-1)?.resultStatus === "failed" ? "failed" : "pending";
}

function supersededContentIds(intents: SyncIntentDetails[], desired: SyncIntentDetails | undefined,
  pending: (code: string, intentId?: string) => void): Set<string> {
  const byId = new Map(intents.map(details => [details.syncIntent.id, details]));
  const validEdges = new Map<string, string>();
  const invalidSources = new Set<string>();
  for (const { syncIntent: source } of intents) {
    if (!source.supersedesSyncIntentId) continue;
    const target = byId.get(source.supersedesSyncIntentId)?.syncIntent;
    const valid = source.operation === "update" && target?.operation === "update" &&
      target.sequenceNumber! < source.sequenceNumber! && !intents.some(({ syncIntent: barrier }) =>
        barrier.operation !== "update" && barrier.sequenceNumber! > target.sequenceNumber! &&
        barrier.sequenceNumber! < source.sequenceNumber!);
    if (valid) validEdges.set(source.id, target.id);
    else {
      invalidSources.add(source.id);
      pending("invalid_supersession", source.id);
    }
  }
  const result = new Set<string>();
  let current = desired?.syncIntent.id;
  while (current && validEdges.has(current)) {
    if (invalidSources.has(current) || invalidSources.has(validEdges.get(current)!)) return new Set();
    current = validEdges.get(current)!;
    result.add(current);
  }
  return result;
}
