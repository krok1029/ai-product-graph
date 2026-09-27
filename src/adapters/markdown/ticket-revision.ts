// Ticket Revision projection 固定使用該 revision 的 specification 與 required targets。
import type { TicketRevision } from "../../domain/models.js";
import { list, markdownText, safeFilenamePart } from "./text.js";

export function renderTicketRevision(revision: TicketRevision) {
  const specification = revision.specification;
  const lines = [
    "# Ticket Revision", "", `## ${markdownText(revision.title)}`, "",
    `Revision: ${markdownText(revision.id)} (${revision.revisionNumber})`,
    `Ticket: ${markdownText(revision.ticketId)}`,
    `Project: ${markdownText(revision.projectId)}`,
    `Review Status: ${revision.reviewStatus}`,
    `Base Approved Revision: ${markdownText(revision.baseApprovedRevisionId ?? "None")}`,
    `Source Graph Revision: ${markdownText(revision.sourceGraphRevisionId)}`,
    `Ticket Draft Batch: ${markdownText(revision.ticketDraftBatchId ?? "None")}`,
    `Approved By: ${markdownText(revision.approvedByActorId ?? "None")}`,
    `Approved At: ${markdownText(revision.approvedAt ?? "None")}`,
    `Created At: ${markdownText(revision.createdAt)}`,
    `Traces To Ticket: ${markdownText(specification.traces_to_ticket_id ?? "None")}`, "",
    "## User Story", markdownText(specification.user_story), "",
    "## Scope", ...list(specification.scope), "",
    "## Acceptance Criteria",
    ...list(specification.acceptance_criteria.map(criterion => `${criterion.id}: ${criterion.text}`)), "",
    "## Non-goals", ...list(specification.non_goals), "",
    "## Related Graph Nodes", ...list(specification.related_graph_node_ids), "",
    "## Dependencies", ...list(specification.dependencies), "",
    "## Required Implementation Targets"
  ];
  if (!revision.requiredTargets.length) lines.push("- None");
  for (const target of revision.requiredTargets) {
    lines.push(`### Repository: ${markdownText(target.repository_id)}`, ...list(target.scope), "");
  }
  lines.push("", "## Implementation Notes", ...list(specification.implementation_notes));
  return {
    markdown: `${lines.join("\n")}\n`,
    suggestedFilename: `ticket-revision-${safeFilenamePart(revision.id)}-r${revision.revisionNumber}.md`
  };
}
