import { ApplicationError } from "../domain/errors.js";
import type {
  AuditLogEntry,
  GraphEdge,
  GraphNode,
  ImplementationTarget,
  Repository,
  Ticket,
  TicketDraftBatch,
  TicketRevision,
  TicketSpecification
} from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

export type TicketSpecInput = {
  title: string;
  tracesToTicketId?: string | null;
  userStory: string;
  scope: string[];
  acceptanceCriteria: string[];
  nonGoals: string[];
  relatedGraphNodeIds: string[];
  dependencies?: string[];
  implementationTargets: Array<{
    repositoryId: string;
    scope: string[];
  }>;
  implementationNotes: string[];
};

type TicketWorkflowOptions = {
  idFactory: () => string;
  clock: () => Date;
  actor: {
    id: string;
    displayName: string;
  };
};

type ProposedImplementationTarget = {
  implementationTargetId: string | null;
  repositoryId: string;
  scope: string[];
  identityAction: "reuse" | "create_on_approval";
};

export class TicketWorkflow {
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly options: TicketWorkflowOptions
  ) {}

  createDraftBatch(input: {
    projectId: string;
    sourceGraphRevisionId: string;
    sourceNodeIds: string[];
    tickets: TicketSpecInput[];
  }) {
    const now = this.options.clock().toISOString();

    return this.ports.transactions.run(() => {
      const project = this.requireActiveProject(input.projectId);
      this.requireCurrentGraphRevision(project.id, input.sourceGraphRevisionId);
      const sourceNodeIds = normalizeStringArray(
        input.sourceNodeIds,
        "source_node_ids"
      );
      this.requireActiveGraphNodes(project.id, sourceNodeIds);
      if (!Array.isArray(input.tickets) || input.tickets.length === 0) {
        throw validationError("Ticket Draft Batch requires at least one ticket.");
      }

      const batch: TicketDraftBatch = {
        id: this.options.idFactory(),
        projectId: project.id,
        sourceGraphRevisionId: input.sourceGraphRevisionId,
        lifecycleStatus: "active",
        createdAt: now,
        updatedAt: now
      };
      this.ports.ticketDraftBatches.insert(batch);

      const created = input.tickets.map(ticketInput => {
        const normalized = this.normalizeTicketSpecInput(
          project.id,
          input.sourceGraphRevisionId,
          ticketInput
        );
        const ticketId = this.options.idFactory();
        const ticket: Ticket = {
          id: ticketId,
          projectId: project.id,
          slug: this.uniqueTicketSlug(
            project.id,
            slugify(normalized.title) ||
              `ticket-${ticketId.slice(-8).toLowerCase()}`,
            ticketId
          ),
          title: normalized.title,
          currentApprovedRevisionId: null,
          lifecycleStatus: "active",
          deliveryStatus: "planned",
          createdAt: now,
          updatedAt: now
        };
        const revision = this.buildRevision({
          ticket,
          batchId: batch.id,
          sourceGraphRevisionId: input.sourceGraphRevisionId,
          baseApprovedRevisionId: null,
          revisionNumber: 1,
          normalized,
          now
        });
        this.ports.tickets.insert(ticket);
        this.ports.ticketRevisions.insert(
          revision,
          normalized.relatedGraphNodeIds,
          normalized.dependencies
        );
        return {
          ticket,
          revision,
          proposedImplementationTargets:
            revision.requiredTargets.map(target => ({
              implementationTargetId: null,
              repositoryId: target.repository_id,
              scope: target.scope,
              identityAction: "create_on_approval" as const
            }))
        };
      });

      const audit = this.newAuditEntry({
        projectId: project.id,
        action: "ticket_draft_batch.created",
        entityType: "ticket_draft_batch",
        entityId: batch.id,
        afterSummary: {
          batch,
          ticketRevisionIds: created.map(item => item.revision.id)
        },
        createdAt: now
      });
      this.ports.auditLog.append(audit);

      return {
        ticketDraftBatch: batch,
        tickets: created,
        validation: { warnings: [] as string[] },
        auditLogId: audit.id
      };
    });
  }

  createRevisionDraft(input: {
    ticketId: string;
    baseApprovedRevisionId: string;
    sourceGraphRevisionId: string;
    specification: TicketSpecInput;
  }) {
    const now = this.options.clock().toISOString();

    return this.ports.transactions.run(() => {
      const ticket = this.requireActiveTicket(input.ticketId);
      if (ticket.currentApprovedRevisionId !== input.baseApprovedRevisionId) {
        throw ticketBaseConflict(
          input.baseApprovedRevisionId,
          ticket.currentApprovedRevisionId
        );
      }
      this.requireCurrentGraphRevision(
        ticket.projectId,
        input.sourceGraphRevisionId
      );
      const normalized = this.normalizeTicketSpecInput(
        ticket.projectId,
        input.sourceGraphRevisionId,
        input.specification
      );
      const proposedImplementationTargets =
        this.proposeImplementationTargets(ticket.id, normalized.requiredTargets);
      const revision = this.buildRevision({
        ticket,
        batchId: null,
        sourceGraphRevisionId: input.sourceGraphRevisionId,
        baseApprovedRevisionId: ticket.currentApprovedRevisionId,
        revisionNumber:
          this.ports.ticketRevisions.nextRevisionNumber(ticket.id),
        normalized,
        now
      });
      this.ports.ticketRevisions.insert(
        revision,
        normalized.relatedGraphNodeIds,
        normalized.dependencies
      );
      const audit = this.newAuditEntry({
        projectId: ticket.projectId,
        action: "ticket_revision.draft_created",
        entityType: "ticket_revision",
        entityId: revision.id,
        afterSummary: { revision },
        createdAt: now
      });
      this.ports.auditLog.append(audit);

      return {
        ticket,
        revision,
        proposedImplementationTargets,
        archivedStaleRevisionIds: [] as string[],
        auditLogId: audit.id
      };
    });
  }

  approveRevision(ticketRevisionId: string) {
    const now = this.options.clock().toISOString();

    return this.ports.transactions.run(() => {
      const revision = this.ports.ticketRevisions.findById(ticketRevisionId);
      if (!revision) {
        throw new ApplicationError(
          "NOT_FOUND",
          "Ticket Revision was not found.",
          { ticketRevisionId }
        );
      }
      const ticket = this.requireActiveTicket(revision.ticketId);
      if (revision.baseApprovedRevisionId !== ticket.currentApprovedRevisionId) {
        throw ticketBaseConflict(
          revision.baseApprovedRevisionId,
          ticket.currentApprovedRevisionId
        );
      }
      if (
        revision.reviewStatus !== "draft" ||
        revision.lifecycleStatus !== "active"
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Ticket Revision is not an active draft.",
          {
            ticketRevisionId,
            reviewStatus: revision.reviewStatus,
            lifecycleStatus: revision.lifecycleStatus
          }
        );
      }
      this.requireCurrentGraphRevision(
        revision.projectId,
        revision.sourceGraphRevisionId
      );
      this.validateApprovalGraphSources(revision);
      this.validateApprovedDependencies(revision);
      this.requireProductGoalOrPainPoint(revision);

      this.ports.localActors.ensure({
        id: this.options.actor.id,
        displayName: this.options.actor.displayName,
        createdAt: now,
        updatedAt: now
      });

      const implementationTargets = this.reconcileImplementationTargets(
        revision,
        now
      );
      const previousApprovedRevisionId = ticket.currentApprovedRevisionId;
      const pointerUpdated =
        this.ports.tickets.updateCurrentApprovedRevision(
          ticket.id,
          revision.baseApprovedRevisionId,
          revision.id,
          revision.title,
          "planned",
          now
        );
      if (!pointerUpdated) {
        const current =
          this.ports.tickets.findById(ticket.id)?.currentApprovedRevisionId ??
          null;
        throw ticketBaseConflict(revision.baseApprovedRevisionId, current);
      }
      this.ports.ticketRevisions.approve(
        revision.id,
        this.options.actor.id,
        now
      );
      const archivedStaleRevisionIds =
        this.ports.ticketRevisions.archiveStaleDrafts(
          ticket.id,
          revision.id,
          revision.id,
          now
        );
      const archivedArtifacts = previousApprovedRevisionId
        ? this.ports.implementationArtifacts.archiveActiveForTicketRevision(
            previousApprovedRevisionId,
            now
          )
        : {
            implementationBriefIds: [] as string[],
            implementationResultIds: [] as string[]
          };

      const approvedRevision: TicketRevision = {
        ...revision,
        reviewStatus: "approved",
        approvedByActorId: this.options.actor.id,
        approvedAt: now,
        updatedAt: now
      };
      const updatedTicket: Ticket = {
        ...ticket,
        title: revision.title,
        currentApprovedRevisionId: revision.id,
        deliveryStatus: "planned",
        updatedAt: now
      };
      const audit = this.newAuditEntry({
        projectId: revision.projectId,
        actorId: this.options.actor.id,
        action: "ticket_revision.approved",
        entityType: "ticket_revision",
        entityId: revision.id,
        afterSummary: {
          ticket: updatedTicket,
          revision: approvedRevision,
          implementationTargets,
          archivedStaleRevisionIds,
          archivedImplementationBriefIds:
            archivedArtifacts.implementationBriefIds,
          archivedImplementationResultIds:
            archivedArtifacts.implementationResultIds
        },
        createdAt: now
      });
      this.ports.auditLog.append(audit);

      return {
        ticket: updatedTicket,
        revision: approvedRevision,
        implementationTargets,
        archivedImplementationTargetIds:
          implementationTargets.archivedTargetIds,
        archivedImplementationBriefIds:
          archivedArtifacts.implementationBriefIds,
        archivedImplementationResultIds:
          archivedArtifacts.implementationResultIds,
        archivedStaleRevisionIds,
        createdSyncIntentIds: [] as string[],
        auditLogId: audit.id
      };
    });
  }

  getContext(input: { ticketId: string; includeMarkdown?: boolean }) {
    const ticket = this.requireActiveTicket(input.ticketId);
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
    if (!revision) {
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
      .filter((node): node is GraphNode => node !== null);
    const relatedNodeSet = new Set(relatedNodes.map(node => node.id));
    const relatedEdges = this.ports.graphEdges
      .list(ticket.projectId, "active")
      .filter(
        edge =>
          relatedNodeSet.has(edge.sourceNodeId) &&
          relatedNodeSet.has(edge.targetNodeId)
      );
    return {
      ticket,
      revision,
      relatedNodes,
      relatedEdges,
      markdown: input.includeMarkdown
        ? renderTicketMarkdown(ticket, revision, relatedNodes, relatedEdges)
        : null
    };
  }

  private normalizeTicketSpecInput(
    projectId: string,
    sourceGraphRevisionId: string,
    input: TicketSpecInput
  ) {
    const title = normalizeRequiredString(input.title, "title");
    const userStory = normalizeRequiredString(input.userStory, "user_story");
    const scope = normalizeStringArray(input.scope, "scope");
    const nonGoals = normalizeStringArray(input.nonGoals, "non_goals");
    const implementationNotes = normalizeStringArray(
      input.implementationNotes,
      "implementation_notes"
    );
    const acceptanceCriteria = normalizeStringArray(
      input.acceptanceCriteria,
      "acceptance_criteria"
    );
    if (acceptanceCriteria.length === 0) {
      throw validationError("Ticket acceptance_criteria requires at least one item.");
    }
    const relatedGraphNodeIds = normalizeStringArray(
      input.relatedGraphNodeIds,
      "related_graph_node_ids"
    );
    if (relatedGraphNodeIds.length === 0) {
      throw validationError("Ticket related_graph_node_ids requires at least one item.");
    }
    this.requireActiveGraphNodes(projectId, relatedGraphNodeIds);
    const dependencies = normalizeStringArray(
      input.dependencies ?? [],
      "dependencies"
    );
    for (const dependencyId of dependencies) {
      const dependency = this.ports.tickets.findById(dependencyId);
      if (!dependency || dependency.projectId !== projectId) {
        throw new ApplicationError(
          "NOT_FOUND",
          "Ticket dependency was not found in the Project.",
          { dependencyId, projectId }
        );
      }
    }
    const tracesToTicketId = input.tracesToTicketId?.trim() || null;
    if (tracesToTicketId) {
      const traced = this.ports.tickets.findById(tracesToTicketId);
      if (
        !traced ||
        traced.projectId !== projectId ||
        !["active", "archived"].includes(traced.lifecycleStatus)
      ) {
        throw new ApplicationError(
          "NOT_FOUND",
          "Traced Ticket was not found in the Project.",
          { tracesToTicketId, projectId }
        );
      }
    }
    const requiredTargets = this.normalizeRequiredTargets(
      projectId,
      input.implementationTargets
    );
    return {
      title,
      userStory,
      scope,
      acceptanceCriteria,
      nonGoals,
      relatedGraphNodeIds,
      tracesToTicketId,
      dependencies: [...new Set(dependencies)],
      requiredTargets,
      implementationNotes,
      sourceGraphRevisionId
    };
  }

  private normalizeRequiredTargets(
    projectId: string,
    targets: TicketSpecInput["implementationTargets"]
  ) {
    if (!Array.isArray(targets) || targets.length === 0) {
      throw validationError("Ticket implementation_targets requires at least one item.");
    }
    const seen = new Set<string>();
    return targets.map((target, index) => {
      if (!isRecord(target)) {
        throw validationError(`implementation_targets[${index}] must be an object.`);
      }
      const repositoryId = normalizeRequiredString(
        target.repositoryId,
        `implementation_targets[${index}].repository_id`
      );
      if (seen.has(repositoryId)) {
        throw validationError(
          "Ticket Revision cannot repeat the same repository_id."
        );
      }
      seen.add(repositoryId);
      const repository = this.requireActiveRepository(projectId, repositoryId);
      return {
        repository_id: repository.id,
        scope: normalizeStringArray(
          target.scope,
          `implementation_targets[${index}].scope`
        )
      };
    });
  }

  private buildRevision(input: {
    ticket: Ticket;
    batchId: string | null;
    sourceGraphRevisionId: string;
    baseApprovedRevisionId: string | null;
    revisionNumber: number;
    normalized: ReturnType<TicketWorkflow["normalizeTicketSpecInput"]>;
    now: string;
  }): TicketRevision {
    return {
      id: this.options.idFactory(),
      ticketId: input.ticket.id,
      projectId: input.ticket.projectId,
      ticketDraftBatchId: input.batchId,
      revisionNumber: input.revisionNumber,
      baseApprovedRevisionId: input.baseApprovedRevisionId,
      sourceGraphRevisionId: input.sourceGraphRevisionId,
      title: input.normalized.title,
      specification: {
        traces_to_ticket_id: input.normalized.tracesToTicketId,
        user_story: input.normalized.userStory,
        scope: input.normalized.scope,
        acceptance_criteria: input.normalized.acceptanceCriteria.map(
          (criterion, index) => ({
            id: `${input.ticket.id}:r${input.revisionNumber}:ac${index + 1}`,
            text: criterion
          })
        ),
        non_goals: input.normalized.nonGoals,
        related_graph_node_ids: input.normalized.relatedGraphNodeIds,
        dependencies: input.normalized.dependencies,
        implementation_notes: input.normalized.implementationNotes
      },
      requiredTargets: input.normalized.requiredTargets,
      reviewStatus: "draft",
      lifecycleStatus: "active",
      approvedByActorId: null,
      approvedAt: null,
      createdAt: input.now,
      updatedAt: input.now
    };
  }

  private reconcileImplementationTargets(revision: TicketRevision, now: string) {
    const activeTargets = this.ports.implementationTargets.listActiveByTicketId(
      revision.ticketId
    );
    const activeByRepository = new Map(
      activeTargets.map(target => [target.repositoryId, target])
    );
    const requiredRepositories = new Set(
      revision.requiredTargets.map(target => target.repository_id)
    );
    const targets: Array<
      ImplementationTarget & { identityAction: "created" | "reused" }
    > = [];
    const archivedTargetIds: string[] = [];

    for (const required of revision.requiredTargets) {
      const existing = activeByRepository.get(required.repository_id);
      if (existing) {
        targets.push({ ...existing, identityAction: "reused" });
      } else {
        const target: ImplementationTarget = {
          id: this.options.idFactory(),
          projectId: revision.projectId,
          ticketId: revision.ticketId,
          repositoryId: required.repository_id,
          lifecycleStatus: "active",
          createdAt: now,
          updatedAt: now
        };
        this.ports.implementationTargets.insert(target);
        targets.push({ ...target, identityAction: "created" });
      }
    }

    for (const target of activeTargets) {
      if (!requiredRepositories.has(target.repositoryId)) {
        this.ports.implementationTargets.archive(target.id, now);
        archivedTargetIds.push(target.id);
      }
    }

    return { targets, archivedTargetIds };
  }

  private proposeImplementationTargets(
    ticketId: string,
    targets: TicketRevision["requiredTargets"]
  ): ProposedImplementationTarget[] {
    return targets.map(target => {
      const existing =
        this.ports.implementationTargets.findActiveByTicketAndRepository(
          ticketId,
          target.repository_id
        );
      return {
        implementationTargetId: existing?.id ?? null,
        repositoryId: target.repository_id,
        scope: target.scope,
        identityAction: existing ? "reuse" : "create_on_approval"
      };
    });
  }

  private validateApprovalGraphSources(revision: TicketRevision) {
    for (const nodeId of revision.specification.related_graph_node_ids) {
      const node = this.ports.graphNodes.findById(nodeId);
      if (
        !node ||
        node.projectId !== revision.projectId ||
        node.lifecycleStatus !== "active"
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Ticket Revision references a graph node that is not active.",
          { ticketRevisionId: revision.id, graphNodeId: nodeId }
        );
      }
    }
  }

  private validateApprovedDependencies(revision: TicketRevision) {
    for (const dependencyId of revision.specification.dependencies) {
      const dependency = this.ports.tickets.findById(dependencyId);
      if (
        !dependency ||
        dependency.projectId !== revision.projectId ||
        dependency.lifecycleStatus !== "active" ||
        !dependency.currentApprovedRevisionId
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Ticket Revision dependency does not have an active approved revision.",
          { ticketRevisionId: revision.id, dependencyId }
        );
      }
    }
  }

  private requireProductGoalOrPainPoint(revision: TicketRevision) {
    const nodes = revision.specification.related_graph_node_ids
      .map(nodeId => this.ports.graphNodes.findById(nodeId))
      .filter((node): node is GraphNode => node !== null);
    if (!nodes.some(node => node.type === "product_goal" || node.type === "pain_point")) {
      throw new ApplicationError(
        "CONFLICT",
        "Approved Ticket Revision must trace to at least one product goal or pain point.",
        { ticketRevisionId: revision.id }
      );
    }
  }

  private requireActiveProject(projectId: string) {
    const project = this.ports.projects.findById(projectId);
    if (!project) {
      throw new ApplicationError("NOT_FOUND", "Project was not found.", {
        projectId
      });
    }
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Project is archived.", {
        projectId
      });
    }
    return project;
  }

  private requireActiveTicket(ticketId: string) {
    const ticket = this.ports.tickets.findById(ticketId);
    if (!ticket) {
      throw new ApplicationError("NOT_FOUND", "Ticket was not found.", {
        ticketId
      });
    }
    if (ticket.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Ticket is archived.", {
        ticketId
      });
    }
    return ticket;
  }

  private requireCurrentGraphRevision(
    projectId: string,
    sourceGraphRevisionId: string
  ) {
    const project = this.requireActiveProject(projectId);
    if (project.currentGraphRevisionId !== sourceGraphRevisionId) {
      throw new ApplicationError(
        "CONFLICT",
        "Ticket source Graph Revision is not current.",
        {
          sourceGraphRevisionId,
          currentGraphRevisionId: project.currentGraphRevisionId
        }
      );
    }
  }

  private requireActiveGraphNodes(projectId: string, nodeIds: string[]) {
    for (const nodeId of nodeIds) {
      const node = this.ports.graphNodes.findById(nodeId);
      if (
        !node ||
        node.projectId !== projectId ||
        node.lifecycleStatus !== "active"
      ) {
        throw new ApplicationError(
          "NOT_FOUND",
          "GraphNode was not found in the active Project graph.",
          { nodeId, projectId }
        );
      }
    }
  }

  private requireActiveRepository(
    projectId: string,
    repositoryId: string
  ): Repository {
    const repository = this.ports.repositories.findById(repositoryId);
    if (
      !repository ||
      repository.projectId !== projectId ||
      repository.lifecycleStatus !== "active"
    ) {
      throw new ApplicationError(
        "NOT_FOUND",
        "Repository was not found in the active Project.",
        { repositoryId, projectId }
      );
    }
    return repository;
  }

  private uniqueTicketSlug(
    projectId: string,
    baseSlug: string,
    ticketId: string
  ) {
    if (!this.ports.tickets.findBySlug(projectId, baseSlug)) {
      return baseSlug;
    }
    return `${baseSlug}-${ticketId.slice(-6).toLowerCase()}`;
  }

  private newAuditEntry(input: {
    projectId: string;
    action: string;
    entityType: string;
    entityId: string;
    afterSummary: Record<string, unknown>;
    createdAt: string;
    actorId?: string;
  }): AuditLogEntry {
    return {
      id: this.options.idFactory(),
      projectId: input.projectId,
      actorType: "mcp_client",
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeSummary: null,
      afterSummary: input.afterSummary,
      metadata: {},
      createdAt: input.createdAt
    };
  }
}

function renderTicketMarkdown(
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

function bulletList(items: string[]) {
  return items.length > 0 ? items.map(item => `- ${item}`) : ["- None"];
}

function normalizeRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError(`Ticket ${field} is required.`);
  }
  return value.trim();
}

function normalizeStringArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw validationError(`Ticket ${field} must be an array.`);
  }
  return [...new Set(value.map(item => normalizeRequiredString(item, field)))];
}

function ticketBaseConflict(
  expectedBaseRevisionId: string | null,
  currentApprovedRevisionId: string | null
) {
  return new ApplicationError(
    "CONFLICT",
    "Ticket Revision base is no longer current.",
    { expectedBaseRevisionId, currentApprovedRevisionId }
  );
}

function validationError(message: string) {
  return new ApplicationError("VALIDATION_ERROR", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
