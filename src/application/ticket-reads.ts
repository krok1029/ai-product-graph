// Ticket identity 與 approved context 讀取；保留明確來源引用的歷史狀態。
import { ApplicationError } from "../domain/errors.js";
import type { GraphEdge, GraphNode, Ticket } from "../domain/models.js";
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
    const activeEdges = this.ports.graphEdges.list(ticket.projectId, "active");
    const lineage = this.readLineage(ticket, activeEdges);
    const relatedEdges = activeEdges.filter(edge =>
      relatedNodeSet.has(edge.sourceNodeId) && relatedNodeSet.has(edge.targetNodeId)
    );
    return {
      ticket,
      revision,
      relatedNodes,
      relatedEdges,
      ...lineage,
      markdown: input.includeMarkdown
        ? renderTicketMarkdown(ticket, revision, relatedNodes, relatedEdges)
        :null
    };
  }

  private readLineage(ticket: Ticket, edges: GraphEdge[]) {
    // 關係來自 canonical edge；尚未核准的 replacement proposal 不改目前 lineage。
    const traces = edges.filter(edge => edge.sourceNodeId === ticket.id && edge.relationType === "traces_to");
    if (traces.length > 1) {
      throw new ApplicationError("STORAGE_ERROR", "Ticket has multiple active trace edges.", { ticketId: ticket.id });
    }
    const traceEdge = traces[0] ?? null;
    if (!traceEdge) return { tracedTicket: null, traceEdge: null };
    const tracedTicket = this.ports.tickets.findById(traceEdge.targetNodeId);
    if (!tracedTicket || tracedTicket.projectId !== ticket.projectId) {
      throw new ApplicationError("STORAGE_ERROR", "Ticket trace target is inconsistent.", {
        ticketId: ticket.id, traceEdgeId: traceEdge.id
      });
    }
    // 原 Ticket 即使 archived 仍是歷史來源；active-only graph traversal 的規則不變。
    return { tracedTicket, traceEdge };
  }
}
