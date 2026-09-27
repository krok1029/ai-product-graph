import { ApplicationError } from "../domain/errors.js";
import type { SyncIntentDetails } from "../domain/sync-intent.js";
import type { MappingSyncHealth } from "../domain/sync-health.js";
import type { ApplicationPorts } from "./ports.js";
import { MappingSyncHealthReads } from "./mapping-sync-health-reads.js";
import { SyncIntentReads } from "./sync-intent-reads.js";
import { hashJson, planeExportPayload } from "./plane-export-payload.js";

type Health = MappingSyncHealth["syncHealth"];
type Reason = { code: string; mappingId?: string; intentId?: string };
export type TicketSyncHealth = {
  ticketId: string;
  syncHealth: Health;
  activeMappingCount: number;
  outstandingExportCount: number;
  mappings: (MappingSyncHealth & { mappingId: string; externalWorkItemId: string })[];
  outstandingExports: { intentId: string; syncHealth: Health; requestState: SyncIntentDetails["requestState"] }[];
  reasons: Reason[];
};

export class TicketSyncHealthReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(ticketId: string): TicketSyncHealth {
    // 整個 owner 聚合共用 read snapshot，不能混入 worker 在兩次查詢間提交的半套結果。
    return this.ports.transactions.run(() => {
      const ticket = this.ports.tickets.findById(ticketId);
      if (!ticket) throw new ApplicationError("NOT_FOUND", "Ticket was not found.");
      const result: TicketSyncHealth = { ticketId, syncHealth: "current", activeMappingCount: 0,
        outstandingExportCount: 0, mappings: [], outstandingExports: [], reasons: [] };
      const mappings = this.ports.externalWorkItems.listTicketMappings(ticketId);
      const healthReads = new MappingSyncHealthReads(this.ports);
      for (const mapping of mappings.filter(value => value.lifecycleStatus === "active")) {
        const health = healthReads.get(mapping.id);
        result.mappings.push({ mappingId: mapping.id, externalWorkItemId: mapping.externalWorkItemId, ...health });
        result.activeMappingCount++;
        result.syncHealth = combine(result.syncHealth, health.syncHealth);
        result.reasons.push(...health.reasons.map(reason => ({ ...reason, mappingId: mapping.id })));
      }
      const requests = new SyncIntentReads(this.ports).listTicketExportRequests(ticketId).requests;
      for (const request of requests.filter(value => value.syncIntent.lifecycleStatus === "active")) {
        const intent = request.syncIntent;
        const success = request.attempts.find(attempt => attempt.resultStatus === "succeeded");
        const valid = this.validRequest(request, ticket.id, ticket.projectId);
        const linkedMapping = success && mappings.some(mapping => mapping.externalWorkItemId === success.externalWorkItemId &&
          mapping.externalContainerId === intent.externalContainerId && mapping.sourceTicketRevisionId === intent.sourceTicketRevisionId &&
          isRecord(mapping.metadata) && mapping.metadata.created_by_sync_intent_id === intent.id);
        // 完成的 create 不重複計數；已 archive mapping 的既有成功仍保留完整歷史。
        if (valid && success && linkedMapping) continue;
        const syncHealth: Health = valid && !success && request.requestState === "failed" ? "failed" : "pending";
        result.outstandingExports.push({ intentId: intent.id, syncHealth, requestState: request.requestState });
        result.outstandingExportCount++;
        result.syncHealth = combine(result.syncHealth, syncHealth);
        result.reasons.push({ code: !valid ? "invalid_obligation" : success ? "incomplete_history" : "outstanding_export", intentId: intent.id });
      }
      // 一般歷史 API 會隱藏不合 scope 的資料；健康度不能把被隱藏的義務誤報為 current。
      if (this.ports.externalWorkItems.hasInvalidTicketMappings(ticketId) ||
          this.ports.syncIntents.hasInvalidTicketExportRequests(ticketId)) {
        result.syncHealth = combine(result.syncHealth, "pending");
        result.reasons.push({ code: "incomplete_history" });
      }
      if (!result.activeMappingCount && !result.outstandingExportCount && !result.reasons.length) {
        result.reasons.push({ code: "not_enrolled" });
      }
      return result;
    });
  }

  private validRequest({ syncIntent: intent, attempts }: SyncIntentDetails, ticketId: string, projectId: string): boolean {
    const revision = intent.sourceTicketRevisionId && this.ports.ticketRevisions.findById(intent.sourceTicketRevisionId);
    const container = intent.externalContainerId && this.ports.externalContainers.findById(intent.externalContainerId);
    try {
      return intent.projectId === projectId && intent.mappingId === null && intent.sequenceNumber === null &&
        intent.operation === "create" && intent.sourceEventType === "plane_ticket_export_requested" &&
        !!revision && revision.ticketId === ticketId && revision.projectId === projectId && revision.reviewStatus === "approved" &&
        !!container && container.provider === "plane" && intent.payload.schema_version === 1 &&
        isRecord(intent.payload.owner) && intent.payload.owner.type === "ticket" && intent.payload.owner.id === ticketId &&
        intent.payload.source_ticket_revision_id === revision.id && hashJson(intent.payload) === intent.payloadHash &&
        hashJson(planeExportPayload(revision)) === intent.payloadHash &&
        attempts.every(attempt => attempt.syncIntentId === intent.id && attempt.operation === intent.operation &&
          attempt.idempotencyKey === intent.idempotencyKey && ["started", "succeeded", "failed"].includes(attempt.resultStatus) &&
          (attempt.resultStatus === "started" ? attempt.completedAt === null : attempt.completedAt !== null));
    } catch { return false; }
  }
}

function combine(left: Health, right: Health): Health {
  return left === "failed" || right === "failed" ? "failed" : left === "pending" || right === "pending" ? "pending" : "current";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
