import { ApplicationError } from "../domain/errors.js";
import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { Ticket, TicketRevision } from "../domain/models.js";
import type { SyncIntent } from "../domain/sync-intent.js";
import { hashJson, planeExportPayload } from "./plane-export-payload.js";
import type { ApplicationPorts } from "./ports.js";

type SourceEvent = { type: string; id: string; now: string };

// 呼叫端必須已在 domain transaction 中；這裡只保存 outbox，不呼叫 provider。
export class PlaneMappingEnrollment {
  constructor(private readonly ports: ApplicationPorts, private readonly idFactory: () => string) {}

  onRevisionApproved(ticketBefore: Ticket, revision: TicketRevision, auditLogId: string, now: string): string[] {
    const event = { type: "ticket_revision.approved", id: auditLogId, now };
    return this.activeMappings(ticketBefore.id).flatMap(mapping => {
      const ids = [this.enqueue(mapping, revision, "update", planeExportPayload(revision), event)];
      if (ticketBefore.deliveryStatus === "done") {
        ids.push(this.enqueueStatus(mapping, revision, "planned", event));
      }
      return ids;
    });
  }

  onDeliveryChanged(ticketBefore: Ticket, status: Ticket["deliveryStatus"], auditLogId: string, now: string): string[] {
    if ((ticketBefore.deliveryStatus === "done") === (status === "done")) return [];
    const mappings = this.activeMappings(ticketBefore.id);
    if (mappings.length === 0) return [];
    const revision = this.requireCurrentRevision(ticketBefore, false);
    const event = { type: status === "done" ? "implementation_result.accepted" : "result_acceptance.revoked", id: auditLogId, now };
    return mappings.map(mapping => this.enqueueStatus(mapping, revision, status, event));
  }

  onCreated({ intent, mapping, now }: { intent: SyncIntent; mapping: ExternalWorkItemMapping; now: string }): void {
    const ticket = this.ports.tickets.findById(mapping.internalOwnerId);
    // 封存不是新的 desired state；保留首次匯出的 pinned history，但不為退出範圍的 owner 製造工作。
    if (!ticket || ticket.lifecycleStatus !== "active" || this.ports.projects.findById(ticket.projectId)?.lifecycleStatus !== "active") return;
    const revision = this.requireCurrentRevision(ticket);
    const event = { type: "plane_mapping.created", id: intent.sourceEventId, now };
    if (revision.id !== intent.sourceTicketRevisionId) {
      this.enqueue(mapping, revision, "update", planeExportPayload(revision), event);
    }
    if (ticket.deliveryStatus === "done") this.enqueueStatus(mapping, revision, "done", event);
  }

  private activeMappings(ticketId: string) {
    // Mapping 本身是 enrollment 邊界；外部 item 封存不能靜默解除既有同步義務。
    return this.ports.externalWorkItems.listTicketMappings(ticketId).filter(mapping =>
      mapping.lifecycleStatus === "active");
  }

  private requireCurrentRevision(ticket: Ticket, requireActive = true): TicketRevision {
    const revision = ticket.currentApprovedRevisionId && this.ports.ticketRevisions.findById(ticket.currentApprovedRevisionId);
    if (!revision || revision.ticketId !== ticket.id || revision.projectId !== ticket.projectId ||
        revision.reviewStatus !== "approved" || (requireActive && revision.lifecycleStatus !== "active")) {
      throw new ApplicationError("CONFLICT", "Plane enrollment requires the current active approved Ticket Revision.");
    }
    return revision;
  }

  private enqueueStatus(mapping: ExternalWorkItemMapping, revision: TicketRevision, status: Ticket["deliveryStatus"], event: SourceEvent) {
    return this.enqueue(mapping, revision, status === "done" ? "close" : "reopen", {
      schema_version: 1, owner: { type: "ticket", id: revision.ticketId },
      source_ticket_revision_id: revision.id, delivery_status: status
    }, event);
  }

  private enqueue(mapping: ExternalWorkItemMapping, revision: TicketRevision, operation: string, payload: Record<string, unknown>, event: SourceEvent): string {
    const idempotencyKey = `plane-mapping:${hashJson({ mapping_id: mapping.id, operation,
      source_event_type: event.type, source_event_id: event.id })}`;
    const existing = this.ports.syncIntents.findByIdempotencyKey(idempotencyKey);
    if (existing) return existing.id;
    const intent: SyncIntent = {
      id: this.idFactory(), projectId: mapping.projectId, mappingId: mapping.id,
      externalContainerId: mapping.externalContainerId,
      sequenceNumber: this.ports.planeEnrollment.allocateSequence(mapping.id, event.now),
      operation, sourceEventType: event.type, sourceEventId: event.id, sourceTicketRevisionId: revision.id,
      payloadHash: hashJson(payload), payload, idempotencyKey, supersedesSyncIntentId: null,
      lifecycleStatus: "active", createdAt: event.now
    };
    this.ports.syncIntents.insert(intent);
    return intent.id;
  }
}
