import { ApplicationError } from "../domain/errors.js";
import type { SyncIntent, SyncIntentRequestState } from "../domain/sync-intent.js";
import { classifyMappingSyncObligations, type MappingSyncObligationDisposition,
  type MappingSyncAttemptState } from "./mapping-sync-obligations.js";
import { MappingSyncReads } from "./mapping-sync-reads.js";
import { MappingTerminationReads } from "./mapping-termination-reads.js";
import type { ApplicationPorts } from "./ports.js";

type IntentIdentity = Pick<SyncIntent, "id" | "sequenceNumber" | "operation" | "sourceTicketRevisionId">;
export type MappingSyncPlan = {
  mappingId: string;
  included: boolean;
  state: "inactive" | "invalid_history" | "waiting_for_attempt" | "retry_required" | "ready" | "idle";
  nextIntent: IntentIdentity | null;
  blockingIntentIds: string[];
  entries: (IntentIdentity & { disposition: MappingSyncObligationDisposition;
    attemptState: MappingSyncAttemptState; requestState: SyncIntentRequestState })[];
  reasons: { code: string; intentId?: string }[];
  terminationId: string | null;
};

export class MappingSyncPlanReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(mappingId: string): MappingSyncPlan {
    // 計畫只是同一 snapshot 的觀測；未取得 claim，也不終止過期 attempt。
    return this.ports.transactions.run(() => {
      const plan: MappingSyncPlan = { mappingId, included: true, state: "invalid_history", nextIntent: null,
        blockingIntentIds: [], entries: [], reasons: [], terminationId: null };
      let mapping;
      try { mapping = this.ports.externalWorkItems.findMappingById(mappingId); }
      catch (error) { return damaged(plan, error); }
      if (!mapping) throw new ApplicationError("NOT_FOUND", "External Work Item mapping was not found.", { mappingId });
      plan.included = mapping.lifecycleStatus === "active";
      if (!plan.included) {
        plan.state = "inactive";
        plan.reasons.push({ code: "mapping_archived" });
      }
      try {
        const history = new MappingTerminationReads(this.ports).get(mappingId);
        plan.terminationId = history.termination?.termination.id ?? null;
      } catch (error) { damaged(plan, error); }
      try {
        const history = new MappingSyncReads(this.ports).get(mappingId);
        const ticket = this.ports.tickets.findById(mapping.internalOwnerId);
        const revision = ticket?.currentApprovedRevisionId && this.ports.ticketRevisions.findById(ticket.currentApprovedRevisionId);
        if (!ticket || !revision || revision.ticketId !== ticket.id || revision.projectId !== mapping.projectId ||
            revision.reviewStatus !== "approved") {
          plan.reasons.push({ code: "incomplete_history" });
          return plan;
        }
        const classified = classifyMappingSyncObligations({ ...history, ticket });
        plan.entries = classified.entries.map(({ details, disposition, attemptState }) => ({
          ...identity(details.syncIntent), disposition, attemptState, requestState: details.requestState
        }));
        plan.reasons.push(...classified.diagnostics);
        if (!plan.included || plan.reasons.length > 0) return plan;
        const first = plan.entries.find(entry => entry.sequenceNumber !== null && entry.disposition === "required");
        if (!first) {
          plan.state = "idle";
          plan.reasons.push({ code: "obligations_fulfilled" });
        } else if (first.attemptState === "started") {
          plan.state = "waiting_for_attempt";
          plan.blockingIntentIds = [first.id];
          plan.reasons.push({ code: "attempt_in_progress", intentId: first.id });
        } else {
          plan.state = first.attemptState === "failed" ? "retry_required" : "ready";
          plan.nextIntent = identity(first);
          plan.blockingIntentIds = first.attemptState === "failed" ? [first.id] : [];
          plan.reasons.push({ code: first.attemptState === "failed" ? "intent_failed" : "next_ordered_intent", intentId: first.id });
        }
      } catch (error) { damaged(plan, error); }
      return plan;
    });
  }
}

function identity(intent: IntentIdentity): IntentIdentity {
  return { id: intent.id, sequenceNumber: intent.sequenceNumber, operation: intent.operation,
    sourceTicketRevisionId: intent.sourceTicketRevisionId };
}

function damaged(plan: MappingSyncPlan, error: unknown): MappingSyncPlan {
  // Repository 解析既有 JSON 失敗代表 history 不可證明；其他 storage／程式錯誤仍向外傳遞。
  if (error instanceof SyntaxError) {
    plan.reasons.push({ code: "incomplete_history" });
    return plan;
  }
  if (!(error instanceof ApplicationError) || !["CONFLICT", "NOT_FOUND"].includes(error.code)) throw error;
  const details = error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : null;
  plan.reasons.push({ code: typeof details?.reason === "string" ? details.reason : "incomplete_history",
    ...(typeof details?.intentId === "string" ? { intentId: details.intentId } : {}) });
  return plan;
}
