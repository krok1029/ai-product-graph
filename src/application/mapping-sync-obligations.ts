import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { Ticket } from "../domain/models.js";
import type { SyncIntentDetails } from "../domain/sync-intent.js";
import { validHealthObligation } from "./sync-health-validation.js";

export type MappingSyncHealthInput = {
  mapping: ExternalWorkItemMapping;
  ticket: Pick<Ticket, "id" | "currentApprovedRevisionId" | "deliveryStatus">;
  createRequest: SyncIntentDetails | null;
  intents: SyncIntentDetails[];
};
export type MappingSyncObligationDisposition = "required" | "fulfilled" | "superseded_unstarted" | "obsolete_failed_content";
export type MappingSyncAttemptState = "unstarted" | "started" | "failed" | "succeeded";
export type ClassifiedMappingSyncObligations = {
  included: boolean;
  entries: { details: SyncIntentDetails; disposition: MappingSyncObligationDisposition; attemptState: MappingSyncAttemptState }[];
  diagnostics: { code: string; intentId?: string }[];
};

// 共用不可變 history 的解釋；health 與工作查詢不可各自推測 supersession。
export function classifyMappingSyncObligations(input: MappingSyncHealthInput): ClassifiedMappingSyncObligations {
  const { mapping, ticket, createRequest } = input;
  const result: ClassifiedMappingSyncObligations = { included: mapping.lifecycleStatus === "active", entries: [], diagnostics: [] };
  if (!result.included) return result;
  const diagnose = (code: string, intentId?: string) => {
    result.diagnostics.push(intentId ? { code, intentId } : { code });
  };
  if (mapping.internalOwnerId !== ticket.id || !ticket.currentApprovedRevisionId) diagnose("incomplete_history");
  const valid: SyncIntentDetails[] = [];
  const invalidIds = new Set<string>();
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const details of [...(createRequest ? [createRequest] : []), ...input.intents]) {
    const intent = details.syncIntent;
    const original = details === createRequest;
    if (ids.has(intent.id) || (!original && sequences.has(intent.sequenceNumber!)) ||
        !validHealthObligation(details, mapping, original)) {
      invalidIds.add(intent.id);
      diagnose("invalid_obligation", intent.id);
      continue;
    }
    ids.add(intent.id);
    if (!original) sequences.add(intent.sequenceNumber!);
    valid.push(details);
  }
  const original = valid.find(details => details === createRequest);
  if (!original) diagnose("incomplete_history");
  const mapped = valid.filter(details => details !== createRequest).sort((a, b) =>
    a.syncIntent.sequenceNumber! - b.syncIntent.sequenceNumber! || a.syncIntent.id.localeCompare(b.syncIntent.id));
  if (!Number.isSafeInteger(mapping.nextSequenceNumber) || mapping.nextSequenceNumber < 1 ||
      mapped.length !== mapping.nextSequenceNumber - 1) diagnose("incomplete_history");
  const desired = mapped.filter(details => details.syncIntent.operation === "update" &&
    details.syncIntent.sourceTicketRevisionId === ticket.currentApprovedRevisionId).at(-1);
  if (!desired && original?.syncIntent.sourceTicketRevisionId !== ticket.currentApprovedRevisionId) diagnose("missing_current_content_intent");
  const superseded = supersededContentIds(mapped, input.intents, invalidIds, diagnose);
  result.entries = [...(original ? [original] : []), ...mapped].map(details => {
    const intent = details.syncIntent;
    const attemptState = mappingSyncAttemptState(details);
    let disposition: MappingSyncObligationDisposition = "required";
    if (attemptState === "succeeded") disposition = "fulfilled";
    else if (intent.operation === "update" && desired && attemptState === "failed" &&
        intent.sequenceNumber! < desired.syncIntent.sequenceNumber!) disposition = "obsolete_failed_content";
    else if (attemptState === "unstarted" && superseded.has(intent.id)) disposition = "superseded_unstarted";
    return { details, disposition, attemptState };
  });
  const latestStatus = mapped.filter(details => ["close", "reopen"].includes(details.syncIntent.operation)).at(-1);
  if (ticket.deliveryStatus === "done" && latestStatus?.syncIntent.operation !== "close") diagnose("missing_close_intent");
  if (ticket.deliveryStatus !== "done" && latestStatus?.syncIntent.operation === "close") diagnose("missing_reopen_intent");
  return result;
}

function mappingSyncAttemptState(details: SyncIntentDetails): MappingSyncAttemptState {
  if (details.attempts.some(attempt => attempt.resultStatus === "succeeded")) return "succeeded";
  return details.attempts.at(-1)?.resultStatus ?? "unstarted";
}

// Enrollment 只檢查緊鄰 predecessor，不把整份歷史的可讀性變成 approval 前提。
export function canCoalescePredecessor(details: SyncIntentDetails, mapping: ExternalWorkItemMapping, nextSequence: number): boolean {
  return details.syncIntent.operation === "update" && details.syncIntent.sequenceNumber === nextSequence - 1 &&
    details.attempts.length === 0 && validHealthObligation(details, { ...mapping, nextSequenceNumber: nextSequence + 1 }, false);
}

function supersededContentIds(intents: SyncIntentDetails[], rawIntents: SyncIntentDetails[], invalidIds: Set<string>, diagnose: (code: string, intentId?: string) => void): Set<string> {
  const byId = new Map(intents.map(details => [details.syncIntent.id, details]));
  const edges = new Map<string, string>();
  const neighbors = new Map<string, Set<string>>();
  const invalidSources = new Set(invalidIds);
  // 無效 scope/payload 的中間節點不能因先被排除，就讓 chain 的有效後半段復活。
  const rawIds = new Set(rawIntents.map(details => details.syncIntent.id));
  for (const { syncIntent: source } of rawIntents) {
    const targetId = source.supersedesSyncIntentId;
    if (targetId && rawIds.has(targetId)) {
      for (const [a, b] of [[source.id, targetId], [targetId, source.id]] as const) {
        if (!neighbors.has(a)) neighbors.set(a, new Set());
        neighbors.get(a)!.add(b);
      }
    }
  }
  for (const { syncIntent: source } of intents) {
    if (!source.supersedesSyncIntentId) continue;
    const target = byId.get(source.supersedesSyncIntentId)?.syncIntent;
    const valid = source.operation === "update" && target?.operation === "update" &&
      target.sequenceNumber! < source.sequenceNumber! && !rawIntents.some(({ syncIntent: barrier }) =>
        barrier.mappingId === source.mappingId && barrier.operation !== "update" && barrier.sequenceNumber! > target.sequenceNumber! &&
        barrier.sequenceNumber! < source.sequenceNumber!);
    if (valid) edges.set(source.id, target.id);
    else { invalidSources.add(source.id); diagnose("invalid_supersession", source.id); }
  }
  // 損壞的同一 chain 全部保守保留；獨立且有效的 chain 不因此復活。
  const unsafe = new Set(invalidSources);
  const queue = [...unsafe];
  for (let index = 0; index < queue.length; index++) {
    for (const neighbor of neighbors.get(queue[index]!) ?? []) {
      if (!unsafe.has(neighbor)) { unsafe.add(neighbor); queue.push(neighbor); }
    }
  }
  // Edge 的證明效力不依賴 source 目前是否 desired 或已開始／完成。
  return new Set([...edges].filter(([source, target]) => !unsafe.has(source) && !unsafe.has(target)).map(([, target]) => target));
}
