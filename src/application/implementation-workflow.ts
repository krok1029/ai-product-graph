// Implementation workflow 主流程。
//
// 負責 Implementation Brief drafts、approval 與 handoff freshness checks。
// 這是 coding work 開始前的最後一道 gate，因此會一起驗證 ticket、graph、
// dependency 與 repository snapshot freshness。

import { ApplicationError } from "../domain/errors.js";
import type {
  AuditLogEntry,
  ImplementationBrief,
  ImplementationBriefJson,
  ImplementationTarget,
  ProductBriefVersion,
  Repository,
  RepositoryContextJson,
  RepositoryContextSnapshot,
  Ticket,
  TicketRevision
} from "../domain/models.js";
import {
  evaluateImplementationFreshness,
  evaluateTicketSourceFreshness
} from "./implementation-freshness.js";
import type { ApplicationPorts } from "./ports.js";
import { requireHandoffSource } from "./handoff-source-validation.js";
import {
  isRepositoryContextApprovable,
  normalizeBrief,
  normalizeOptionalText,
  normalizeRepositoryContext,
  normalizeRequiredString,
  nowSlug,
  staleHandoff,
  validationError
} from "./implementation-workflow-helpers.js";

export type RepositoryContextInput= {
  repositoryName: string;
  summary: string;
  fileList: string[];
  moduleNotes: string[];
  baselineCommitSha?: string|null;
  hasUncommittedChanges?: boolean;
  dirtyStateFingerprint?: string|null;
};

export type ImplementationBriefInput= {
  implementationPlan: string[];
  suggestedFilesToInspect: string[];
  testStrategy: string[];
  risks: string[];
  prSummaryDraft: string;
};

type ImplementationWorkflowOptions= {
  idFactory: () => string;
  clock: () => Date;
  actor: {
    id: string;
    displayName: string;
  };
};

export class ImplementationWorkflow {
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly options: ImplementationWorkflowOptions
  ) { }

  createBriefDraft(input: {
    implementationTargetId: string;
    supersedesImplementationBriefId?: string|null;
    repoContext: RepositoryContextInput;
    brief: ImplementationBriefInput;
  }) {
    const now = this.options.clock().toISOString();

    return this.ports.transactions.run(() => {
      const source = this.requireCurrentTargetSource(
        input.implementationTargetId
      );
      const repository = this.requireActiveRepository(
        source.target.projectId,
        source.target.repositoryId
      );
      const context = normalizeRepositoryContext(input.repoContext);
      if (context.repository_name !== repository.name) {
        throw validationError(
          "Repository Context Snapshot repository_name must match the Implementation Target Repository."
        );
      }
      this.requireFreshTicketSources(source.ticket, source.revision);
      const supersedesImplementationBriefId =
        normalizeOptionalText(input.supersedesImplementationBriefId);
      if (supersedesImplementationBriefId) {
        this.requireSupersededBrief(
          supersedesImplementationBriefId,
          source.target.id
        );
      }

      const snapshot: RepositoryContextSnapshot= {
        id: this.options.idFactory(),
        projectId: source.target.projectId,
        repositoryId: repository.id,
        baselineCommitSha: normalizeOptionalText(
          input.repoContext.baselineCommitSha
        ),
        dirtyStateFingerprint: normalizeOptionalText(
          input.repoContext.dirtyStateFingerprint
        ),
        context,
        isApprovable: isRepositoryContextApprovable(
          input.repoContext.baselineCommitSha,
          input.repoContext.hasUncommittedChanges,
          input.repoContext.dirtyStateFingerprint
        ),
        createdAt: now
      };
      const brief: ImplementationBrief= {
        id: this.options.idFactory(),
        projectId: source.target.projectId,
        implementationTargetId: source.target.id,
        ticketRevisionId: source.revision.id,
        productBriefVersionId: source.productBriefVersion.id,
        repositoryContextSnapshotId: snapshot.id,
        supersedesImplementationBriefId,
        slug: `implementation-brief-${source.target.id.slice(-8).toLowerCase()}-${nowSlug(now)}`,
        brief: normalizeBrief(input.brief),
        reviewStatus: "draft",
        lifecycleStatus: "active",
        approvedByActorId: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now
      };
      const audit = this.newAuditEntry({
        projectId: source.target.projectId,
        action: "implementation_brief.draft_created",
        entityType: "implementation_brief",
        entityId: brief.id,
        afterSummary: { implementationBrief: brief, repositoryContext: snapshot },
        createdAt: now
      });

      this.ports.repositoryContextSnapshots.insert(snapshot);
      this.ports.implementationBriefs.insert(brief);
      this.ports.auditLog.append(audit);

      return {
        implementationBrief: brief,
        repositoryContextSnapshot: snapshot,
        auditLogId: audit.id
      };
    });
  }

  approveBrief(implementationBriefId: string) {
    const now = this.options.clock().toISOString();

    return this.ports.transactions.run(() => {
      const brief = this.requireActiveBrief(implementationBriefId);
      if (brief.reviewStatus !== "draft") {
        throw new ApplicationError(
          "CONFLICT",
          "Implementation Brief is already approved.",
          { implementationBriefId }
        );
      }
      const snapshot = this.requireSnapshot(
        brief.repositoryContextSnapshotId
      );
      if (!snapshot.isApprovable||!snapshot.baselineCommitSha) {
        throw new ApplicationError(
          "CONFLICT",
          "Implementation Brief requires a verifiable repository baseline before approval.",
          { implementationBriefId, repositoryContextSnapshotId: snapshot.id }
        );
      }
      const source = this.requireCurrentTargetSource(
        brief.implementationTargetId
      );
      if (source.revision.id !== brief.ticketRevisionId) {
        throw staleHandoff("ticket_revision_not_current", {
          implementationBriefId,
          currentTicketRevisionId: source.revision.id,
          briefTicketRevisionId: brief.ticketRevisionId
        });
      }
      this.requireFreshTicketSources(source.ticket, source.revision);

      const activeApproved =
        this.ports.implementationBriefs.findActiveApprovedByTargetId(
          brief.implementationTargetId
        );
      if (
        activeApproved&&
        activeApproved.id !== brief.supersedesImplementationBriefId
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Replacement Implementation Brief must supersede the current active approved brief.",
          {
            implementationBriefId,
            activeApprovedImplementationBriefId: activeApproved.id
          }
        );
      }
      if (!activeApproved) {
        const latestArchivedApproved =
          this.ports.implementationBriefs.findLatestArchivedApprovedByTargetId(
            brief.implementationTargetId
          );
        if (
          brief.supersedesImplementationBriefId&&
          brief.supersedesImplementationBriefId !== latestArchivedApproved?.id
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "Lineage predecessor must be the latest archived approved Implementation Brief when no active approved brief exists.",
            {
              implementationBriefId,
              supersedesImplementationBriefId:
                brief.supersedesImplementationBriefId,
              latestArchivedApprovedImplementationBriefId:
                latestArchivedApproved?.id ?? null
            }
          );
        }
      }

      this.ports.localActors.ensure({
        id: this.options.actor.id,
        displayName: this.options.actor.displayName,
        createdAt: now,
        updatedAt: now
      });
      if (activeApproved) {
        this.ports.implementationBriefs.archive(activeApproved.id, now);
      }
      this.ports.implementationBriefs.approve(
        brief.id,
        this.options.actor.id,
        now
      );
      const approved: ImplementationBrief= {
        ...brief,
        reviewStatus: "approved",
        approvedByActorId: this.options.actor.id,
        approvedAt: now,
        updatedAt: now
      };
      const audit = this.newAuditEntry({
        projectId: approved.projectId,
        action: "implementation_brief.approved",
        entityType: "implementation_brief",
        entityId: approved.id,
        afterSummary: {
          implementationBrief: approved,
          archivedImplementationBriefId: activeApproved?.id ?? null
        },
        createdAt: now,
        actorId: this.options.actor.id
      });
      this.ports.auditLog.append(audit);

      return {
        implementationBrief: approved,
        archivedImplementationBriefId: activeApproved?.id ?? null,
        auditLogId: audit.id
      };
    });
  }

  getHandoff(input: {
    implementationBriefId: string;
    currentRepositoryState: {
      commitSha: string;
      dirtyStateFingerprint?: string|null;
    };
  }) {
    const brief = this.ports.implementationBriefs.findById(
      input.implementationBriefId
    );
    if (!brief) {
      throw new ApplicationError(
        "NOT_FOUND",
        "Implementation Brief was not found.",
        { implementationBriefId: input.implementationBriefId }
      );
    }
    if (brief.lifecycleStatus !== "active") {
      throw staleHandoff("implementation_brief_archived", {
        implementationBriefId: brief.id
      });
    }
    if (brief.reviewStatus !== "approved") {
      throw staleHandoff("implementation_brief_not_approved", {
        implementationBriefId: brief.id
      });
    }
    const source = requireHandoffSource(this.ports, brief);
    const snapshot = source.snapshot;
    const staleReason = evaluateImplementationFreshness(
      this.ports,
      source.ticket,
      source.revision,
      snapshot,
      input.currentRepositoryState
    );
    if (staleReason) {
      throw staleHandoff(staleReason.reason, staleReason.details);
    }

    return {
      freshness: "current" as const,
      implementationBrief: brief,
      implementationTarget: source.target,
      ticket: source.ticket,
      ticketRevision: source.revision,
      productBriefVersion: source.productBriefVersion,
      repository: source.repository,
      repositoryContextSnapshot: snapshot
    };
  }

  private requireCurrentTargetSource(implementationTargetId: string) {
    const target = this.requireActiveImplementationTarget(
      implementationTargetId
    );
    const ticket = this.requireActiveTicket(target.ticketId);
    if (!ticket.currentApprovedRevisionId) {
      throw new ApplicationError(
        "CONFLICT",
        "Implementation Target Ticket has no approved revision.",
        { implementationTargetId, ticketId: ticket.id }
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
    if (
      !revision.requiredTargets.some(
        required => required.repository_id === target.repositoryId
      )
    ) {
      throw new ApplicationError(
        "CONFLICT",
        "Implementation Target is not required by the current approved Ticket Revision.",
        { implementationTargetId, ticketRevisionId: revision.id }
      );
    }
    const graphRevision = this.ports.graphRevisions.findById(
      revision.sourceGraphRevisionId
    );
    if (!graphRevision||graphRevision.projectId !== revision.projectId) {
      throw new ApplicationError(
        "CONFLICT",
        "Ticket Revision source Graph Revision was not found.",
        { ticketRevisionId: revision.id }
      );
    }
    const productBriefVersion = this.requireProductBriefVersion(
      graphRevision.sourceProductBriefVersionId,
      revision.projectId
    );
    return { target, ticket, revision, productBriefVersion };
  }

  private requireFreshTicketSources(ticket: Ticket, revision: TicketRevision) {
    const sourceProblem = evaluateTicketSourceFreshness(
      this.ports,
      ticket,
      revision
    );
    if (sourceProblem) {
      throw staleHandoff(sourceProblem.reason, sourceProblem.details);
    }
  }

  private requireSupersededBrief(
    implementationBriefId: string,
    implementationTargetId: string
  ) {
    const brief = this.ports.implementationBriefs.findById(
      implementationBriefId
    );
    if (!brief||brief.implementationTargetId !== implementationTargetId) {
      throw new ApplicationError(
        "NOT_FOUND",
        "Superseded Implementation Brief was not found for the same Implementation Target.",
        { implementationBriefId, implementationTargetId }
      );
    }
    return brief;
  }

  private requireActiveImplementationTarget(
    implementationTargetId: string
  ): ImplementationTarget {
    const target = this.ports.implementationTargets.findById(
      implementationTargetId
    );
    if (!target||target.lifecycleStatus !== "active") {
      throw new ApplicationError(
        "NOT_FOUND",
        "Implementation Target was not found.",
        { implementationTargetId }
      );
    }
    return target;
  }

  private requireActiveTicket(ticketId: string): Ticket {
    const ticket = this.ports.tickets.findById(ticketId);
    if (!ticket||ticket.lifecycleStatus !== "active") {
      throw new ApplicationError("NOT_FOUND","Ticket was not found.", {
        ticketId
      });
    }
    return ticket;
  }

  private requireActiveRepository(
    projectId: string,
    repositoryId: string
  ): Repository {
    const repository = this.ports.repositories.findById(repositoryId);
    if (
      !repository||
      repository.projectId !== projectId||
      repository.lifecycleStatus !== "active"
    ) {
      throw new ApplicationError(
        "NOT_FOUND",
        "Repository was not found in the active Project.",
        { projectId, repositoryId }
      );
    }
    return repository;
  }

  private requireProductBriefVersion(
    productBriefVersionId: string,
    projectId: string
  ): ProductBriefVersion {
    const version = this.ports.productBriefVersions.findById(
      productBriefVersionId
    );
    if (
      !version||
      version.projectId !== projectId||
      version.lifecycleStatus !== "active" ||
      version.reviewStatus !== "approved"
    ) {
      throw new ApplicationError(
        "CONFLICT",
        "Product Brief Version was not found or is not approved.",
        { productBriefVersionId, projectId }
      );
    }
    return version;
  }

  private requireActiveBrief(implementationBriefId: string): ImplementationBrief {
    const brief = this.ports.implementationBriefs.findById(
      implementationBriefId
    );
    if (!brief||brief.lifecycleStatus !== "active") {
      throw new ApplicationError(
        "NOT_FOUND",
        "Implementation Brief was not found.",
        { implementationBriefId }
      );
    }
    return brief;
  }

  private requireSnapshot(snapshotId: string): RepositoryContextSnapshot {
    const snapshot = this.ports.repositoryContextSnapshots.findById(snapshotId);
    if (!snapshot) {
      throw new ApplicationError(
        "STORAGE_ERROR",
        "Repository Context Snapshot was not found.",
        { snapshotId }
      );
    }
    return snapshot;
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
