// Product graph service facade。
//
// MCP adapters、smoke tests 與未來 local callers 使用的公開 application
// facade。它維持 caller-facing methods 穩定，並把 workflow-specific rules
// 交給專門的 workflow modules。

import { ulid } from "ulid";
import { MarkdownExport, type MarkdownExportInput } from "./markdown-export.js";

import { ApplicationError } from "../domain/errors.js";
import type {
  AuditLogEntry,
  GraphNodeType,
  Idea,
  LifecycleStatus,
  Project,
  ProductBrief,
  ProductBriefJson,
  ProductBriefVersion
} from "../domain/models.js";
import {
  GraphWorkflow,
  type GraphChangeInput
} from "./graph-workflow.js";
import {
  ImplementationWorkflow,
  type ImplementationBriefInput,
  type RepositoryContextInput
} from "./implementation-workflow.js";
import type { ApplicationPorts } from "./ports.js";
import {
  TicketWorkflow,
  type TicketSpecInput
} from "./ticket-workflow.js";

type ServiceOptions = {
  idFactory?: () => string;
  clock?: () => Date;
  actor?: {
    id: string;
    displayName: string;
  };
};

export class ProductGraphService {
  private readonly idFactory: () => string;
  private readonly clock: () => Date;
  private readonly actor: NonNullable<ServiceOptions["actor"]>;
  private readonly graphWorkflow: GraphWorkflow;
  private readonly ticketWorkflow: TicketWorkflow;
  private readonly implementationWorkflow: ImplementationWorkflow;

  constructor(
    private readonly ports: ApplicationPorts,
    options: ServiceOptions = {}
  ) {
    this.idFactory = options.idFactory ?? ulid;
    this.clock = options.clock ?? (() => new Date());
    this.actor = options.actor ?? {
      id: "00000000000000000000000001",
      displayName: "Local User"
    };
    this.graphWorkflow = new GraphWorkflow(ports, {
      idFactory: this.idFactory,
      clock: this.clock,
      actor: this.actor
    });
    this.ticketWorkflow = new TicketWorkflow(ports, {
      idFactory: this.idFactory,
      clock: this.clock,
      actor: this.actor
    });
    this.implementationWorkflow = new ImplementationWorkflow(ports, {
      idFactory: this.idFactory,
      clock: this.clock,
      actor: this.actor
    });
  }

  createProject(input: { name: string; description?: string }) {
    const name = input.name.trim();
    if (!name) {
      throw new ApplicationError("VALIDATION_ERROR", "Project name is required.");
    }

    const id = this.idFactory();
    const now = this.clock().toISOString();
    const baseSlug = slugify(name) || `project-${id.slice(-8).toLowerCase()}`;
    const slug = this.uniqueProjectSlug(baseSlug, id);
    const project: Project = {
      id,
      slug,
      name,
      description: normalizeOptionalText(input.description),
      lifecycleStatus: "active",
      currentProductBriefId: null,
      currentGraphRevisionId: null,
      lastReconciledProductBriefVersionId: null,
      productIntentGraphRevisionId: null,
      createdAt: now,
      updatedAt: now
    };
    const audit = this.newAuditEntry({
      projectId: id,
      action: "project.created",
      entityType: "project",
      entityId: id,
      afterSummary: project,
      createdAt: now
    });

    this.ports.transactions.run(() => {
      this.ports.projects.insert(project);
      this.ports.auditLog.append(audit);
    });

    return { project, auditLogId: audit.id };
  }

  getMarkdownExportArtifact(input: MarkdownExportInput) {
    return new MarkdownExport(this.ports).readArtifact(input);
  }

  listProjects() {
    return { projects: this.ports.projects.list() };
  }

  getProject(projectId: string) {
    const project = this.requireProject(projectId);
    return {
      project,
      counts: this.ports.projects.getCounts(project.id)
    };
  }

  addIdea(input: { projectId: string; content: string; source: string }) {
    const project = this.requireProject(input.projectId);
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Project is archived.", {
        projectId: project.id
      });
    }

    const content = input.content.trim();
    const source = input.source.trim();
    if (!content || !source) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Idea content and source are required."
      );
    }

    const id = this.idFactory();
    const now = this.clock().toISOString();
    const idea: Idea = {
      id,
      projectId: project.id,
      slug: `idea-${id.slice(-8).toLowerCase()}`,
      content,
      source,
      lifecycleStatus: "active",
      createdAt: now,
      updatedAt: now
    };
    const audit = this.newAuditEntry({
      projectId: project.id,
      action: "idea.added",
      entityType: "idea",
      entityId: id,
      afterSummary: idea,
      createdAt: now
    });

    this.ports.transactions.run(() => {
      this.ports.ideas.insert(idea);
      this.ports.auditLog.append(audit);
    });

    return { idea, auditLogId: audit.id };
  }

  getIdea(ideaId: string) {
    const idea = this.ports.ideas.findById(ideaId);
    if (!idea) {
      throw new ApplicationError("NOT_FOUND", "Idea was not found.", {
        ideaId
      });
    }
    return { idea };
  }

  createProductBriefDraft(input: {
    projectId: string;
    sourceIdeaId: string;
    baseApprovedVersionId: string | null;
    brief: ProductBriefJson;
  }) {
    const normalizedBrief = validateProductBrief(input.brief);
    const now = this.clock().toISOString();

    return this.ports.transactions.run(() => {
      const project = this.requireProject(input.projectId);
      if (project.lifecycleStatus !== "active") {
        throw new ApplicationError("CONFLICT", "Project is archived.", {
          projectId: project.id
        });
      }

      const idea = this.ports.ideas.findById(input.sourceIdeaId);
      if (
        !idea ||
        idea.projectId !== project.id ||
        idea.lifecycleStatus !== "active"
      ) {
        throw new ApplicationError(
          "NOT_FOUND",
          "Source Idea was not found in the active Project.",
          { sourceIdeaId: input.sourceIdeaId, projectId: project.id }
        );
      }

      let productBrief = this.ports.productBriefs.findByProjectId(project.id);
      if (
        productBrief &&
        project.currentProductBriefId !== productBrief.id
      ) {
        throw new ApplicationError(
          "STORAGE_ERROR",
          "Project Product Brief pointer is inconsistent.",
          { projectId: project.id, productBriefId: productBrief.id }
        );
      }
      const currentApprovedVersionId =
        productBrief?.currentApprovedVersionId ?? null;
      if (input.baseApprovedVersionId !== currentApprovedVersionId) {
        throw basePointerConflict(
          input.baseApprovedVersionId,
          currentApprovedVersionId
        );
      }
      if (
        productBrief?.sourceIdeaId &&
        productBrief.sourceIdeaId !== idea.id
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Product Brief is linked to a different source Idea.",
          {
            expectedSourceIdeaId: productBrief.sourceIdeaId,
            sourceIdeaId: idea.id
          }
        );
      }

      if (!productBrief) {
        productBrief = {
          id: this.idFactory(),
          projectId: project.id,
          sourceIdeaId: idea.id,
          slug: "product-brief",
          currentApprovedVersionId: null,
          lifecycleStatus: "active",
          createdAt: now,
          updatedAt: now
        };
        this.ports.productBriefs.insert(productBrief);
        this.ports.projects.setCurrentProductBrief(
          project.id,
          productBrief.id,
          now
        );
      }

      const version: ProductBriefVersion = {
        id: this.idFactory(),
        productBriefId: productBrief.id,
        projectId: project.id,
        versionNumber:
          this.ports.productBriefVersions.nextVersionNumber(productBrief.id),
        baseApprovedVersionId: currentApprovedVersionId,
        brief: normalizedBrief,
        reviewStatus: "draft",
        lifecycleStatus: "active",
        approvedByActorId: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now
      };
      const audit = this.newAuditEntry({
        projectId: project.id,
        action: "product_brief.draft_created",
        entityType: "product_brief_version",
        entityId: version.id,
        afterSummary: { ...version },
        createdAt: now
      });

      this.ports.productBriefVersions.insert(version);
      this.ports.auditLog.append(audit);

      return {
        productBrief,
        version,
        validation: { warnings: [] as string[] },
        auditLogId: audit.id
      };
    });
  }

  approveProductBriefVersion(productBriefVersionId: string) {
    const actor = this.actor;
    const now = this.clock().toISOString();

    return this.ports.transactions.run(() => {
      const version =
        this.ports.productBriefVersions.findById(productBriefVersionId);
      if (!version) {
        throw new ApplicationError(
          "NOT_FOUND",
          "Product Brief Version was not found.",
          { productBriefVersionId }
        );
      }
      const project = this.requireProject(version.projectId);
      const productBrief = this.ports.productBriefs.findByProjectId(
        version.projectId
      );
      if (!productBrief || productBrief.id !== version.productBriefId) {
        throw new ApplicationError(
          "STORAGE_ERROR",
          "Product Brief Version aggregate is inconsistent.",
          { productBriefVersionId }
        );
      }
      if (
        version.baseApprovedVersionId !== productBrief.currentApprovedVersionId
      ) {
        throw basePointerConflict(
          version.baseApprovedVersionId,
          productBrief.currentApprovedVersionId
        );
      }
      if (
        project.lifecycleStatus !== "active" ||
        productBrief.lifecycleStatus !== "active" ||
        version.lifecycleStatus !== "active"
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Product Brief Version is not active.",
          { productBriefVersionId }
        );
      }
      if (version.reviewStatus !== "draft") {
        throw new ApplicationError(
          "CONFLICT",
          "Product Brief Version is not a draft.",
          { productBriefVersionId, reviewStatus: version.reviewStatus }
        );
      }

      this.ports.localActors.ensure({
        id: actor.id,
        displayName: actor.displayName,
        createdAt: now,
        updatedAt: now
      });
      const pointerUpdated =
        this.ports.productBriefs.updateCurrentApprovedVersion(
          productBrief.id,
          version.baseApprovedVersionId,
          version.id,
          now
        );
      if (!pointerUpdated) {
        const current =
          this.ports.productBriefs.findByProjectId(project.id)
            ?.currentApprovedVersionId ?? null;
        throw basePointerConflict(version.baseApprovedVersionId, current);
      }
      this.ports.productBriefVersions.approve(version.id, actor.id, now);
      const archivedStaleVersionIds =
        this.ports.productBriefVersions.archiveStaleDrafts(
          productBrief.id,
          version.id,
          version.id,
          now
        );

      const approvedVersion: ProductBriefVersion = {
        ...version,
        reviewStatus: "approved",
        approvedByActorId: actor.id,
        approvedAt: now,
        updatedAt: now
      };
      const updatedProductBrief: ProductBrief = {
        ...productBrief,
        currentApprovedVersionId: version.id,
        updatedAt: now
      };
      const audit = this.newAuditEntry({
        projectId: project.id,
        actorId: actor.id,
        action: "product_brief.version_approved",
        entityType: "product_brief_version",
        entityId: version.id,
        afterSummary: {
          version: approvedVersion,
          archivedStaleVersionIds
        },
        createdAt: now
      });
      this.ports.auditLog.append(audit);

      return {
        productBrief: updatedProductBrief,
        version: approvedVersion,
        productIntentReconciliation: {
          status:
            project.lastReconciledProductBriefVersionId === version.id
              ? ("current" as const)
              : ("pending" as const),
          currentProductBriefVersionId: version.id,
          lastReconciledProductBriefVersionId:
            project.lastReconciledProductBriefVersionId
        },
        archivedStaleVersionIds,
        auditLogId: audit.id
      };
    });
  }

  createGraphDraftBatch(input: {
    projectId: string;
    baseGraphRevisionId: string | null;
    sourceProductBriefVersionId: string;
    reconciliationSummary?: string;
    changes: GraphChangeInput[];
  }) {
    return this.graphWorkflow.createDraft(input);
  }

  approveGraphDraftBatch(graphDraftBatchId: string) {
    return this.graphWorkflow.approve(graphDraftBatchId);
  }

  getGraphContext(input: {
    projectId: string;
    lifecycleStatus?: LifecycleStatus;
    nodeTypes?: GraphNodeType[];
    maxDepth?: number;
  }) {
    return this.graphWorkflow.getContext(input);
  }

  createTicketDraftBatch(input: {
    projectId: string;
    sourceGraphRevisionId: string;
    sourceNodeIds: string[];
    tickets: TicketSpecInput[];
  }) {
    return this.ticketWorkflow.createDraftBatch(input);
  }

  createTicketRevisionDraft(input: {
    ticketId: string;
    baseApprovedRevisionId: string;
    sourceGraphRevisionId: string;
    specification: TicketSpecInput;
  }) {
    return this.ticketWorkflow.createRevisionDraft(input);
  }

  approveTicketRevision(ticketRevisionId: string) {
    return this.ticketWorkflow.approveRevision(ticketRevisionId);
  }

  getTicketContext(input: {
    ticketId: string;
    includeMarkdown?: boolean;
  }) {
    return this.ticketWorkflow.getContext(input);
  }

  createImplementationBriefDraft(input: {
    implementationTargetId: string;
    supersedesImplementationBriefId?: string | null;
    repoContext: RepositoryContextInput;
    brief: ImplementationBriefInput;
  }) {
    return this.implementationWorkflow.createBriefDraft(input);
  }

  approveImplementationBrief(implementationBriefId: string) {
    return this.implementationWorkflow.approveBrief(implementationBriefId);
  }

  getImplementationHandoff(input: {
    implementationBriefId: string;
    currentRepositoryState: {
      commitSha: string;
      dirtyStateFingerprint?: string | null;
    };
  }) {
    return this.implementationWorkflow.getHandoff(input);
  }

  private requireProject(projectId: string): Project {
    const project = this.ports.projects.findById(projectId);
    if (!project) {
      throw new ApplicationError("NOT_FOUND", "Project was not found.", {
        projectId
      });
    }
    return project;
  }

  private uniqueProjectSlug(baseSlug: string, id: string): string {
    if (!this.ports.projects.findBySlug(baseSlug)) {
      return baseSlug;
    }
    return `${baseSlug}-${id.slice(-6).toLowerCase()}`;
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
      id: this.idFactory(),
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

function basePointerConflict(
  expectedBaseVersionId: string | null,
  currentApprovedVersionId: string | null
): ApplicationError {
  return new ApplicationError(
    "CONFLICT",
    "Product Brief base version is no longer current.",
    { expectedBaseVersionId, currentApprovedVersionId }
  );
}

function validateProductBrief(brief: ProductBriefJson): ProductBriefJson {
  if (!brief || typeof brief !== "object") {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Product Brief must be an object."
    );
  }
  if (typeof brief.product_goal !== "string" || !brief.product_goal.trim()) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Product Brief product_goal is required."
    );
  }
  assertArray(brief.target_users, "target_users");
  assertArray(brief.pain_points, "pain_points");
  assertArray(brief.core_workflows, "core_workflows");
  for (const field of [
    "mvp_scope",
    "non_goals",
    "success_metrics",
    "risks",
    "open_questions"
  ] as const) {
    assertStringArray(brief[field], field);
  }
  for (const user of brief.target_users) {
    assertStringField(user, "name", "target_users");
    assertStringField(user, "description", "target_users");
  }
  for (const painPoint of brief.pain_points) {
    assertStringField(painPoint, "title", "pain_points");
    assertStringField(painPoint, "description", "pain_points");
  }
  for (const workflow of brief.core_workflows) {
    assertStringField(workflow, "title", "core_workflows");
    assertStringArray(workflow.steps, "core_workflows.steps");
  }
  return { ...brief, product_goal: brief.product_goal.trim() };
}

function assertArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Product Brief ${field} must be an array.`
    );
  }
}

function assertStringArray(
  value: unknown,
  field: string
): asserts value is string[] {
  assertArray(value, field);
  if (!value.every(item => typeof item === "string")) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Product Brief ${field} must contain only strings.`
    );
  }
}

function assertStringField(
  value: unknown,
  field: string,
  parent: string
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !(field in value) ||
    typeof value[field as keyof typeof value] !== "string"
  ) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Product Brief ${parent}.${field} must be a string.`
    );
  }
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
