// 來源關係與新鮮度在 application 層共用，避免只靠 skill 維持階層。
import { ApplicationError } from "../domain/errors.js";
import type { GraphNode, TicketRevision } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import { planningContentRevision } from "./planning-content-revision.js";

export function planningChain(ports: ApplicationPorts, projectId: string, nodeId: string): GraphNode[] {
  const chain: GraphNode[] = [];
  let expectedType: string | undefined;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(nodeId)) throw new ApplicationError("CONFLICT", "Planning hierarchy contains a cycle.", { nodeId });
    visited.add(nodeId);
    const node = ports.graphNodes.findById(nodeId);
    if (!node || node.projectId !== projectId || node.lifecycleStatus !== "active" ||
      (expectedType && node.type !== expectedType) || !["spec", "milestone", "product_brief"].includes(node.type)) {
      throw new ApplicationError("CONFLICT", "Planning source is not active in this hierarchy.", { nodeId });
    }
    chain.push(node);
    if (node.type === "product_brief") {
      if (node.metadata.product_brief_version_id !== ports.productBriefs.findByProjectId(projectId)?.currentApprovedVersionId) {
        throw new ApplicationError("CONFLICT", "Planning root is behind the current Product Brief.", { nodeId });
      }
      return chain;
    }
    const parentId = node.metadata.parent_node_id;
    const parent = typeof parentId === "string" ? ports.graphNodes.findById(parentId) : null;
    const edge = ports.graphEdges.list(projectId, "active").find(edge =>
      edge.sourceNodeId === node.id && edge.targetNodeId === parentId && edge.relationType === "belongs_to");
    if (!parent || !edge || node.metadata.source_parent_revision_id !== planningContentRevision(parent)) {
      throw new ApplicationError("CONFLICT", "Planning source changed; reconcile the child before decomposition.", { nodeId, parentId });
    }
    expectedType = node.type === "spec" ? "milestone" : "product_brief";
    nodeId = parent.id;
  }
}

export function ticketPlanningSources(ports: ApplicationPorts, projectId: string, specId: string) {
  const chain = planningChain(ports, projectId, specId);
  if (chain[0]!.type !== "spec") {
    throw new ApplicationError("VALIDATION_ERROR", "Ticket source must be a Spec.", { specId });
  }
  return chain.map(node => node.id);
}

export function projectTicketSpec(ports: ApplicationPorts, revision: TicketRevision, idFactory: () => string, now: string) {
  const specId = revision.specification.source_spec_id;
  const existing = ports.graphEdges.list(revision.projectId, "active").filter(edge =>
    edge.sourceNodeId === revision.ticketId && edge.relationType === "belongs_to" &&
    edge.metadata.owner_ticket_id === revision.ticketId);
  for (const edge of existing) {
    if (edge.targetNodeId !== specId) ports.graphEdges.archive(edge.id, edge.lastChangedInGraphRevisionId, now);
  }
  if (!specId || existing.some(edge => edge.targetNodeId === specId)) return;
  // Ticket 的投影沿用來源 Graph Revision，真正建立投影的 Ticket Revision 另記於 metadata。
  ports.graphEdges.insert({
    id: idFactory(), projectId: revision.projectId, sourceNodeId: revision.ticketId, targetNodeId: specId,
    relationType: "belongs_to", confidence: null, lifecycleStatus: "active",
    createdInGraphRevisionId: revision.sourceGraphRevisionId,
    lastChangedInGraphRevisionId: revision.sourceGraphRevisionId,
    metadata: { owner_ticket_id: revision.ticketId, established_by_ticket_revision_id: revision.id },
    createdAt: now, updatedAt: now
  });
}
