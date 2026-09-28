// Milestone 與 Spec 自身就是版本化圖譜節點，內容和關係在同一 transaction 更新。
import { ApplicationError } from "../domain/errors.js";
import type { GraphNode } from "../domain/models.js";
import { planningContentSchema, type PlanningContent } from "../domain/planning.js";
import { GraphWorkflow, type GraphChangeInput } from "./graph-workflow.js";
import { planningChain } from "./planning-lineage.js";
import { planningContentRevision } from "./planning-content-revision.js";
import { evaluateTicketSourceFreshness } from "./implementation-freshness.js";
import type { ApplicationPorts } from "./ports.js";

type Options = { idFactory: () => string; clock: () => Date };
export type SavePlanningNode = {
  projectId: string;
  baseGraphRevisionId: string | null;
  nodeId?: string;
  parentNodeId?: string;
  title: string;
  document: PlanningContent;
};

export class PlanningWorkflow {
  private readonly graph: GraphWorkflow;
  constructor(private readonly ports: ApplicationPorts, private readonly options: Options) {
    this.graph = new GraphWorkflow(ports, { ...options, planning: true,
      actor: { id: "planning-automation", displayName: "Planning automation" } });
  }

  syncBrief(projectId: string) {
    return this.ports.transactions.run(() => {
      const briefId = this.ports.productBriefs.findByProjectId(projectId)?.currentApprovedVersionId;
      const brief = briefId ? this.ports.productBriefVersions.findById(briefId) : null;
      if (!brief || brief.lifecycleStatus !== "active" || brief.reviewStatus !== "approved") {
        throw new ApplicationError("CONFLICT", "Planning requires a current approved Product Brief.");
      }
      const root = this.root(projectId);
      if (root?.metadata.product_brief_version_id === brief.id) return root;
      const result = this.apply(projectId, [{ changeId: "brief", entityKind: "node",
        operation: root ? "update" : "add", targetId: root?.id ?? null,
        payload: { ...(!root ? { type: "product_brief" } : {}), title: `Product Brief: ${brief.productBriefId}`,
          description: brief.brief.product_goal,
          metadata: { product_brief_id: brief.productBriefId, product_brief_version_id: brief.id, content: brief.brief } }
      }], "Synchronize current Product Brief; descendants retain their source versions.");
      return this.ports.graphNodes.findById(root?.id ?? result.applied.addedIds[0]!)!;
    });
  }

  save(input: SavePlanningNode) {
    return this.ports.transactions.run(() => {
      this.checkBase(input.projectId, input.baseGraphRevisionId);
      const parsed = planningContentSchema.safeParse(input.document);
      if (!parsed.success || !input.title?.trim()) {
        throw new ApplicationError("VALIDATION_ERROR", "Planning node requires a title and complete structured content.",
          { issues: parsed.success ? [] : parsed.error.issues });
      }
      const document = parsed.data;
      const root = this.syncBrief(input.projectId);
      const parentId = input.parentNodeId ?? (document.type === "milestone" ? root.id : "");
      const parent = planningChain(this.ports, input.projectId, parentId)[0]!;
      if (parent.type !== (document.type === "milestone" ? "product_brief" : "milestone")) {
        throw new ApplicationError("VALIDATION_ERROR", "Milestone belongs to Product Brief; Spec belongs to Milestone.");
      }
      const existing = input.nodeId ? this.ports.graphNodes.findById(input.nodeId) : null;
      if (input.nodeId && (!existing || existing.projectId !== input.projectId ||
        existing.lifecycleStatus !== "active" || existing.type !== document.type)) {
        throw new ApplicationError("CONFLICT", "Planning node cannot change type or project, or restore an archived identity.");
      }
      const metadata = { content: document.content, parent_node_id: parent.id,
        source_parent_revision_id: planningContentRevision(parent) };
      const changes: GraphChangeInput[] = [{ changeId: "node", operation: existing ? "update" : "add",
        entityKind: "node", targetId: existing?.id ?? null,
        payload: { ...(!existing ? { type: document.type } : {}), title: input.title.trim(),
          description: document.type === "milestone" ? document.content.outcome : document.content.solution, metadata } }];
      const previousEdges = this.ports.graphEdges.list(input.projectId, "active").filter(edge =>
        edge.sourceNodeId === existing?.id && edge.relationType === "belongs_to");
      for (const edge of previousEdges) {
        if (edge.targetNodeId !== parent.id) changes.push({ changeId: `archive-${edge.id}`, operation: "archive",
          entityKind: "edge", targetId: edge.id, payload: {} });
      }
      if (!previousEdges.some(edge => edge.targetNodeId === parent.id)) changes.push({ changeId: "parent",
        operation: "add", entityKind: "edge", targetId: null,
        payload: { ...(existing ? { source_node_id: existing.id } : { source_change_id: "node" }),
          target_node_id: parent.id, relation_type: "belongs_to" } });
      const result = this.apply(input.projectId, changes, `Save ${document.type}: ${input.title.trim()}`);
      const node = this.ports.graphNodes.findById(existing?.id ?? result.applied.addedIds[0]!)!;
      return { ...result, node, impact: this.inspect(input.projectId) };
    });
  }

  archive(input: { projectId: string; baseGraphRevisionId: string; nodeId: string }) {
    return this.ports.transactions.run(() => {
      this.checkBase(input.projectId, input.baseGraphRevisionId);
      const node = this.ports.graphNodes.findById(input.nodeId);
      if (!node || node.projectId !== input.projectId || node.lifecycleStatus !== "active" ||
        !["milestone", "spec"].includes(node.type)) {
        throw new ApplicationError("CONFLICT", "Only active Milestone or Spec can be archived.");
      }
      const nodes = this.ports.graphNodes.list(input.projectId, "active");
      const ids = new Set([node.id]);
      for (const child of nodes) if (child.type === "spec" && child.metadata.parent_node_id === node.id) ids.add(child.id);
      const edges = this.ports.graphEdges.list(input.projectId, "active").filter(edge =>
        ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId));
      const changes: GraphChangeInput[] = [];
      for (const edge of edges) {
        if (edge.metadata.owner_ticket_id) {
          // Ticket-owned edges 由投影服務清除，與整批 archive 一起回滾。
          this.ports.graphEdges.archive(edge.id, edge.lastChangedInGraphRevisionId, this.options.clock().toISOString());
        } else changes.push({ changeId: `edge-${edge.id}`, operation: "archive", entityKind: "edge", targetId: edge.id, payload: {} });
      }
      for (const id of ids) changes.push({ changeId: `node-${id}`, operation: "archive", entityKind: "node", targetId: id, payload: {} });
      const result = this.apply(input.projectId, changes, `Archive ${node.type} and its descendants: ${node.title}`);
      return { ...result, archivedNodeIds: [...ids], impact: this.inspect(input.projectId) };
    });
  }

  inspect(projectId: string) {
    const nodes = this.ports.graphNodes.list(projectId, "active").filter(node => ["product_brief", "milestone", "spec"].includes(node.type));
    const rootNodeId = nodes.find(node => node.type === "product_brief")?.id ?? null;
    const staleNodeIds = nodes.filter(node => {
      try { planningChain(this.ports, projectId, node.id); return false; } catch { return true; }
    }).map(node => node.id);
    const affectedTicketIds = this.ports.tickets.listByProjectId(projectId).filter(ticket => {
      if (ticket.lifecycleStatus !== "active" || !ticket.currentApprovedRevisionId) return false;
      const revision = this.ports.ticketRevisions.findById(ticket.currentApprovedRevisionId);
      return !revision || evaluateTicketSourceFreshness(this.ports, ticket, revision) !== null;
    }).map(ticket => ticket.id);
    return { rootNodeId, staleNodeIds, affectedTicketIds };
  }

  private root(projectId: string): GraphNode | undefined {
    return this.ports.graphNodes.list(projectId, "active").find(node => node.type === "product_brief");
  }

  private checkBase(projectId: string, base: string | null) {
    const project = this.ports.projects.findById(projectId);
    if (!project || project.lifecycleStatus !== "active") throw new ApplicationError("NOT_FOUND", "Active Project was not found.");
    if (project.currentGraphRevisionId !== base) throw new ApplicationError("CONFLICT", "Planning base graph revision is no longer current.",
      { expectedGraphRevisionId: base, currentGraphRevisionId: project.currentGraphRevisionId });
  }

  private apply(projectId: string, changes: GraphChangeInput[], summary: string) {
    const project = this.ports.projects.findById(projectId)!;
    const source = this.ports.productBriefs.findByProjectId(projectId)?.currentApprovedVersionId;
    if (!source) throw new ApplicationError("CONFLICT", "Approved Product Brief is required.");
    const draft = this.graph.createDraft({ projectId, baseGraphRevisionId: project.currentGraphRevisionId,
      sourceProductBriefVersionId: source, changes, reconciliationSummary: summary });
    return this.graph.approve(draft.graphDraftBatch.id, true);
  }
}
