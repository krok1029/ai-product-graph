// Ticket workflow 輔助工具。
//
// TicketWorkflow 的 rendering 與 normalization helpers。TicketWorkflow 保留
// approval/revision transaction flow；這個 module 負責整理輸入，以及
// get_ticket_context 回傳的 Markdown projection。

import { ApplicationError } from "../domain/errors.js";
import type { GraphEdge, GraphNode, Ticket, TicketRevision } from "../domain/models.js";

export function renderTicketMarkdown(
  ticket: Ticket,
  revision: TicketRevision,
  relatedNodes: GraphNode[],
  relatedEdges: GraphEdge[]
) {
  const lines = [
    `# ${revision.title}`,
    "",
    `Ticket: ${ticket.id}`,
    `Revision: ${revision.id}`,
    `Delivery Status: ${ticket.deliveryStatus}`,
    "",
    "## User Story",
    revision.specification.user_story,
    "",
    "## Scope",
    ...bulletList(revision.specification.scope),
    "",
    "## Acceptance Criteria",
    ...revision.specification.acceptance_criteria.map(
      criterion => `- [${criterion.id}] ${criterion.text}`
    ),
    "",
    "## Related Graph Nodes",
    ...relatedNodes.map(node => `- ${node.type}: ${node.title} (${node.id})`),
    "",
    "## Related Graph Edges",
    ...relatedEdges.map(
      edge =>
        `- ${edge.sourceNodeId} ${edge.relationType} ${edge.targetNodeId}`
    )
  ];
  return `${lines.join("\n")}\n`;
}

export function bulletList(items: string[]) {
  return items.length>0? items.map(item => `- ${item}`):["- None"];
}

export function normalizeRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" ||!value.trim()) {
    throw validationError(`Ticket ${field} is required.`);
  }
  return value.trim();
}

export function normalizeStringArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw validationError(`Ticket ${field} must be an array.`);
  }
  return [...new Set(value.map(item => normalizeRequiredString(item, field)))];
}

export function ticketBaseConflict(
  expectedBaseRevisionId: string|null,
  currentApprovedRevisionId: string|null
) {
  return new ApplicationError(
    "CONFLICT",
    "Ticket Revision base is no longer current.",
    { expectedBaseRevisionId, currentApprovedRevisionId }
  );
}

export function validationError(message: string) {
  return new ApplicationError("VALIDATION_ERROR", message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"&&value !== null&&!Array.isArray(value);
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu,"-")
    .replace(/^-+|-+$/g,"")
    .slice(0,80);
}
