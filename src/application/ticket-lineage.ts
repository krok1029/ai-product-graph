// Follow-up lineage 由 Ticket 生命週期維護，不推進產品意圖 Graph Revision。
import { ApplicationError } from "../domain/errors.js";
import type { GraphEdge, TicketRevision } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

export class TicketLineage {
  constructor(private readonly ports: ApplicationPorts, private readonly idFactory: () => string) {}

  current(projectId: string, ticketId: string) {
    return this.ports.graphEdges.list(projectId, "active").find(edge =>
      edge.sourceNodeId === ticketId && edge.relationType === "traces_to" &&
      edge.createdInGraphRevisionId === null) ?? null;
  }

  validate(projectId: string, ticketId: string | null, targetId: string | null) {
    if (targetId === null) return;
    if (targetId === ticketId) {
      throw new ApplicationError("VALIDATION_ERROR", "Follow-up Ticket cannot trace to itself.", { ticketId });
    }
    const original = this.ports.tickets.findById(targetId);
    if (!original || original.projectId !== projectId) {
      throw new ApplicationError("NOT_FOUND", "Traced Ticket was not found in the Project.", { tracesToTicketId: targetId, projectId });
    }
  }

  reconcile(revision: TicketRevision, now: string) {
    const targetId = revision.specification.traces_to_ticket_id;
    this.validate(revision.projectId, revision.ticketId, targetId);
    const previous = this.current(revision.projectId, revision.ticketId);
    let current = previous;
    if (previous?.targetNodeId !== targetId) {
      if (previous) this.ports.graphEdges.archive(previous.id, null, now);
      current = null;
      if (targetId !== null) {
        current = {
          id: this.idFactory(), projectId: revision.projectId, sourceNodeId: revision.ticketId,
          targetNodeId: targetId, relationType: "traces_to", confidence: null, lifecycleStatus: "active",
          createdInGraphRevisionId: null, lastChangedInGraphRevisionId: null,
          metadata: { owner_ticket_id: revision.ticketId, established_by_ticket_revision_id: revision.id },
          createdAt: now, updatedAt: now
        } satisfies GraphEdge;
        this.ports.graphEdges.insert(current);
      }
    }
    return {
      followupTicketId: revision.ticketId, ticketRevisionId: revision.id, sourceNodeId: revision.ticketId,
      previousOriginalTicketId: previous?.targetNodeId ?? null,
      originalTicketId: current?.targetNodeId ?? null, targetNodeId: current?.targetNodeId ?? null,
      previousEdgeId: previous?.id ?? null, edgeId: current?.id ?? null,
      archivedEdgeId: previous && previous.id !== current?.id ? previous.id : null
    };
  }
}
