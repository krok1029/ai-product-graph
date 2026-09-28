// 階段摘要只投影目前核准的來源身分；交付、新鮮度與驗收是獨立的計數軸。
import type { GraphNode } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import type { DeliveryReads } from "./delivery-reads.js";

type TicketDelivery = ReturnType<DeliveryReads["ticket"]>;

export function summarizeDelivery(tickets: TicketDelivery[]) {
  return {
    total: tickets.length,
    done: tickets.filter(ticket => ticket.delivery_status === "done").length,
    stale: tickets.filter(ticket => ticket.source_freshness === "stale").length,
    blocked: tickets.filter(ticket => ticket.blocking_dependency_ids.length > 0 || ticket.delivery_status === "blocked").length,
    awaiting_acceptance: tickets.filter(ticket => ticket.targets.some(target => target.pending_result_id)).length,
    delivery_status_counts: {
      planned: tickets.filter(ticket => ticket.delivery_status === "planned").length,
      in_progress: tickets.filter(ticket => ticket.delivery_status === "in_progress").length,
      blocked: tickets.filter(ticket => ticket.delivery_status === "blocked").length,
      done: tickets.filter(ticket => ticket.delivery_status === "done").length
    },
    source_freshness_counts: {
      current: tickets.filter(ticket => ticket.source_freshness === "current").length,
      stale: tickets.filter(ticket => ticket.source_freshness === "stale").length,
      unapproved: tickets.filter(ticket => ticket.source_freshness === "unapproved").length
    }
  };
}

function content(node: GraphNode): Record<string, unknown> {
  const value = node.metadata.content;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stageProgress(ports: ApplicationPorts, projectId: string, tickets: TicketDelivery[]) {
  const nodes = ports.graphNodes.list(projectId);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = ports.graphEdges.list(projectId, "active");
  const parentEdge = (node: GraphNode, parent: GraphNode) => node.metadata.parent_node_id === parent.id
    ? edges.find(edge => edge.sourceNodeId === node.id && edge.targetNodeId === parent.id && edge.relationType === "belongs_to")
    : undefined;
  const hasParent = (node: GraphNode, parent: GraphNode) => Boolean(parentEdge(node, parent));
  const approvedParentProblem = (chain: GraphNode[], sourceRevisionId: string) => {
    const source = ports.graphRevisions.findById(sourceRevisionId);
    if (!source || source.projectId !== projectId) return "approved_ancestry_unverifiable";
    for (let index = 0; index < chain.length - 1; index++) {
      const edge = parentEdge(chain[index]!, chain[index + 1]!);
      const created = edge?.createdInGraphRevisionId ? ports.graphRevisions.findById(edge.createdInGraphRevisionId) : null;
      const changed = edge?.lastChangedInGraphRevisionId ? ports.graphRevisions.findById(edge.lastChangedInGraphRevisionId) : null;
      if (!created || !changed || created.projectId !== projectId || changed.projectId !== projectId) {
        return "approved_ancestry_unverifiable";
      }
      // 額外引用不是父歸屬。現存關係必須在核准來源版本時已成立，之後也未變更。
      if (created.sequenceNumber > source.sequenceNumber) return "approved_ancestry_changed";
      if (changed.sequenceNumber > source.sequenceNumber) return "approved_ancestry_unverifiable";
    }
    return null;
  };
  const milestones = nodes.filter(node => node.type === "milestone" && node.lifecycleStatus === "active")
    .sort((a, b) => Number(content(a).sequence ?? 0) - Number(content(b).sequence ?? 0) || a.id.localeCompare(b.id));
  const specs = nodes.filter(node => node.type === "spec" && node.lifecycleStatus === "active").sort((a, b) => a.id.localeCompare(b.id));
  const grouped = new Map<string, TicketDelivery[]>();
  const ungrouped: Array<{ ticket_id: string; source_spec_id: string | null; reason: string }> = [];
  for (const ticket of tickets) {
    const revision = ticket.approved_revision_id ? ports.ticketRevisions.findById(ticket.approved_revision_id) : null;
    const specId = revision?.specification.source_spec_id ?? null;
    let reason: string | null = null;
    if (!revision) reason = "unapproved_ticket";
    else if (revision.ticketId !== ticket.ticket_id || revision.projectId !== projectId ||
      revision.reviewStatus !== "approved" || revision.lifecycleStatus !== "active") reason = "invalid_approved_revision";
    else if (!specId) reason = "legacy_without_spec";
    else {
      const spec = byId.get(specId);
      const milestone = spec ? byId.get(String(spec.metadata.parent_node_id)) : undefined;
      const root = milestone ? byId.get(String(milestone.metadata.parent_node_id)) : undefined;
      if (!spec) reason = "source_spec_missing";
      else if (spec.lifecycleStatus !== "active") reason = "source_spec_archived";
      else if (spec.type !== "spec") reason = "source_spec_invalid";
      else if (!milestone || !root) reason = "source_ancestry_missing";
      else if (milestone.lifecycleStatus !== "active" || root.lifecycleStatus !== "active") reason = "source_ancestry_archived";
      else if (milestone.type !== "milestone" || root.type !== "product_brief" ||
        !hasParent(spec, milestone) || !hasParent(milestone, root)) reason = "source_ancestry_invalid";
      else if (![spec, milestone, root].every(node => ports.ticketRevisions.listGraphNodeIds(revision.id).includes(node.id))) {
        reason = "approved_ancestry_changed";
      } else reason = approvedParentProblem([spec, milestone, root], revision.sourceGraphRevisionId);
    }
    if (reason) ungrouped.push({ ticket_id: ticket.ticket_id, source_spec_id: specId, reason });
    else grouped.set(specId!, [...(grouped.get(specId!) ?? []), ticket]);
  }
  const group = (entries: TicketDelivery[]) => ({
    ticket_ids: entries.map(ticket => ticket.ticket_id), summary: summarizeDelivery(entries)
  });
  const ungroupedIds = new Set(ungrouped.map(entry => entry.ticket_id));
  return {
    scope: "active_project_tickets" as const,
    completion: "not_evaluated" as const,
    milestones: milestones.map(milestone => {
      const children = specs.filter(spec => hasParent(spec, milestone));
      return {
        milestone_id: milestone.id, title: milestone.title,
        outcome: content(milestone).outcome ?? null, sequence: content(milestone).sequence ?? null,
        exit_criteria: content(milestone).exit_criteria ?? [], completion: "not_evaluated" as const,
        ...group(children.flatMap(spec => grouped.get(spec.id) ?? [])),
        specs: children.map(spec => ({ spec_id: spec.id, title: spec.title, ...group(grouped.get(spec.id) ?? []) }))
      };
    }),
    ungrouped: { ...group(tickets.filter(ticket => ungroupedIds.has(ticket.ticket_id))), tickets: ungrouped },
    ungrouped_specs: specs.filter(spec => !milestones.some(milestone => hasParent(spec, milestone)))
      .map(spec => ({ spec_id: spec.id, title: spec.title, reason: "active_milestone_relation_missing" }))
  };
}
