// Ticket identity 與 approved context 讀取；保留明確來源引用的歷史狀態。
import { ApplicationError } from "../domain/errors.js";
import type { GraphNode } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import { renderTicketMarkdown } from "./ticket-workflow-helpers.js";

export class TicketReads {
  constructor(private readonly ports: ApplicationPorts) {}

  getTicket(ticketId: string) {
    const ticket = this.ports.tickets.findById(ticketId);
    if (!ticket) throw new ApplicationError("NOT_FOUND", "Ticket was not found.", { ticketId });
    return { ticket };
  }

  getContext(input: { ticketId: string; includeMarkdown?: boolean }) {
    const { ticket } = this.getTicket(input.ticketId);
    if (ticket.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Ticket is archived.", { ticketId: ticket.id });
    }
    if (!ticket.currentApprovedRevisionId) {
      throw new ApplicationError(
        "CONFLICT",
        "Ticket has no approved revision.",
        { ticketId: ticket.id }
      );
    }
    const revision = this.ports.ticketRevisions.findById(
      ticket.currentApprovedRevisionId
    );
    if (!revision || revision.ticketId !== ticket.id || revision.projectId !== ticket.projectId ||
        revision.reviewStatus !== "approved" || revision.lifecycleStatus !== "active") {
      throw new ApplicationError(
        "STORAGE_ERROR",
        "Ticket current approved revision pointer is inconsistent.",
        { ticketId: ticket.id }
      );
    }
    const relatedNodeIds =
      this.ports.ticketRevisions.listGraphNodeIds(revision.id);
    const relatedNodes = relatedNodeIds
      .map(nodeId => this.ports.graphNodes.findById(nodeId))
      .filter((node): node is GraphNode => node !== null && node.projectId === ticket.projectId);
    const relatedNodeSet = new Set(relatedNodes.map(node => node.id));
    const relatedEdges = this.ports.graphEdges
      .list(ticket.projectId,"active")
      .filter(
        edge =>
          relatedNodeSet.has(edge.sourceNodeId)&&
          relatedNodeSet.has(edge.targetNodeId)
      );
    return {
      ticket,
      revision,
      relatedNodes,
      relatedEdges,
      markdown: input.includeMarkdown
        ? renderTicketMarkdown(ticket, revision, relatedNodes, relatedEdges)
        :null
    };
  }

}
