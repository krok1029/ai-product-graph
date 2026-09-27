import { ApplicationError } from "../domain/errors.js";
import type { AuditLogEntry, Ticket } from "../domain/models.js";
import type { SyncIntent } from "../domain/sync-intent.js";
import type { ApplicationPorts } from "./ports.js";
import { normalizeRequiredString } from "./implementation-workflow-helpers.js";
import { hashJson, planeExportKey, planeExportPayload, type PlaneExportCommand } from "./plane-export-payload.js";

type Options = {
  idFactory: () => string;
  clock: () => Date;
  actor: { id: string; displayName: string };
};

export class PlaneExportWorkflow {
  constructor(private readonly ports: ApplicationPorts, private readonly options: Options) {}

  request(input: PlaneExportCommand & { idempotencyKey: string }) {
    const command = {
      ticketId: normalizeRequiredString(input.ticketId, "ticket_id"),
      sourceTicketRevisionId: normalizeRequiredString(input.sourceTicketRevisionId, "source_ticket_revision_id"),
      externalContainerId: normalizeRequiredString(input.externalContainerId, "external_container_id")
    };
    const clientKey = normalizeRequiredString(input.idempotencyKey, "idempotency_key");
    // 先只解析 identity，確定 key 的 Project scope；成功 replay 不受後續狀態改變影響。
    const ticket = this.ports.tickets.findById(command.ticketId);
    if (!ticket) throw new ApplicationError("NOT_FOUND", "Ticket was not found.", { ticketId: command.ticketId });
    const scopedKey = planeExportKey(ticket.projectId, this.options.actor.id, clientKey);

    return this.ports.transactions.run(() => {
      const existing = this.ports.syncIntents.findByIdempotencyKey(scopedKey);
      if (existing) return this.replay(existing, command, ticket.projectId);
      // Identity lookup 僅供 replay scope；首次執行必須在 transaction 內重讀可變狀態。
      const currentTicket = this.ports.tickets.findById(command.ticketId);
      if (!currentTicket || currentTicket.projectId !== ticket.projectId) {
        throw new ApplicationError("CONFLICT", "Ticket identity changed before export validation.");
      }
      const revision = this.requireSource(currentTicket, command);
      if (this.ports.syncIntents.hasActiveTicketMapping(ticket.id, command.externalContainerId) ||
          this.ports.syncIntents.hasOutstandingTicketCreate(ticket.id, command.externalContainerId)) {
        throw new ApplicationError("CONFLICT", "Ticket already has a mapping or outstanding export request in this container.");
      }
      const now = this.options.clock().toISOString();
      const auditId = this.options.idFactory();
      const payload = planeExportPayload(revision);
      const intent: SyncIntent = {
        id: this.options.idFactory(), projectId: ticket.projectId, mappingId: null,
        externalContainerId: command.externalContainerId, sequenceNumber: null,
        operation: "create", sourceEventType: "plane_ticket_export_requested", sourceEventId: auditId,
        sourceTicketRevisionId: revision.id, payload, payloadHash: hashJson(payload),
        idempotencyKey: scopedKey, supersedesSyncIntentId: null, lifecycleStatus: "active", createdAt: now
      };
      const audit: AuditLogEntry = {
        id: auditId, projectId: ticket.projectId, actorType: "mcp_client", actorId: this.options.actor.id,
        action: "plane_ticket_export.requested", entityType: "sync_intent", entityId: intent.id,
        beforeSummary: null, afterSummary: { ticketId: ticket.id, sourceTicketRevisionId: revision.id,
          externalContainerId: command.externalContainerId, syncIntentId: intent.id, payloadHash: intent.payloadHash },
        metadata: {}, createdAt: now
      };
      this.ports.localActors.ensure({ id: this.options.actor.id, displayName: this.options.actor.displayName,
        createdAt: now, updatedAt: now });
      this.ports.syncIntents.insert(intent);
      this.ports.auditLog.append(audit);
      return { syncIntent: intent, auditLogId: auditId };
    });
  }

  private replay(intent: SyncIntent, command: PlaneExportCommand, projectId: string) {
    const owner = intent.payload.owner as { type?: unknown; id?: unknown } | undefined;
    const storedCommand = { ticketId: owner?.id, sourceTicketRevisionId: intent.sourceTicketRevisionId,
      externalContainerId: intent.externalContainerId };
    if (intent.projectId !== projectId || intent.operation !== "create" ||
        intent.sourceEventType !== "plane_ticket_export_requested" || owner?.type !== "ticket" ||
        typeof owner.id !== "string" || hashJson(storedCommand) !== hashJson(command)) {
      throw new ApplicationError("CONFLICT", "Idempotency key was already used for a different export command.");
    }
    return { syncIntent: intent, auditLogId: intent.sourceEventId };
  }

  private requireSource(ticket: Ticket, command: PlaneExportCommand) {
    const project = this.ports.projects.findById(ticket.projectId);
    if (!project || project.lifecycleStatus !== "active" || ticket.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Plane export requires an active Project and Ticket.");
    }
    const revision = this.ports.ticketRevisions.findById(command.sourceTicketRevisionId);
    if (!revision || revision.ticketId !== ticket.id || revision.projectId !== ticket.projectId ||
        revision.reviewStatus !== "approved" || revision.lifecycleStatus !== "active" ||
        ticket.currentApprovedRevisionId !== revision.id) {
      throw new ApplicationError("CONFLICT", "Plane export requires this Ticket's current active approved revision.");
    }
    const container = this.ports.externalContainers.findById(command.externalContainerId);
    if (!container) throw new ApplicationError("NOT_FOUND", "External Container was not found.");
    if (container.provider !== "plane") throw new ApplicationError("CONFLICT", "Ticket export requires a Plane container.");
    return revision;
  }
}
