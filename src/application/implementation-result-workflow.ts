// Implementation Result workflow。
//
// 負責 Observed Evidence ingestion 與 Implementation Result submission。
// Result Acceptance 會是下一個 workflow；這裡只建立不可變 draft/archived
// submission，並沿用 shared freshness evaluator 判斷來源是否 stale。

import { normalizeObservedEvidencePayload } from "./observed-evidence-payload.js";
import { ApplicationError } from "../domain/errors.js";
import type {
  AcceptanceCriterionVerdict,
  AuditLogEntry,
  ImplementationBrief,
  ImplementationResult,
  ImplementationTarget,
  ObservedEvidence,
  ObservedEvidenceType,
  ProductBriefVersion,
  Repository,
  Ticket,
  TicketRevision
} from "../domain/models.js";
import { evaluateImplementationFreshness } from "./implementation-freshness.js";
import type { ApplicationPorts } from "./ports.js";
import {
  normalizeOptionalText,
  normalizeRequiredString,
  staleHandoff,
  validationError
} from "./implementation-workflow-helpers.js";

export type CriterionVerdictInput = {
  acceptanceCriterionId: string;
  verdict: "satisfied" | "unsatisfied";
  reason: string;
  evidenceIds: string[];
};

type ImplementationResultWorkflowOptions = {
  idFactory: () => string;
  clock: () => Date;
};

type BriefSource = {
  target: ImplementationTarget;
  ticket: Ticket;
  revision: TicketRevision;
  repository: Repository;
  productBriefVersion: ProductBriefVersion;
};

export class ImplementationResultWorkflow {
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly options: ImplementationResultWorkflowOptions
  ) { }

  recordObservedEvidence(input: {
    projectId: string;
    repositoryId: string;
    evidenceType: ObservedEvidenceType;
    idempotencyKey: string;
    payload: unknown;
  }) {
    const now = this.options.clock().toISOString();
    const idempotencyKey = normalizeRequiredString(
      input.idempotencyKey,
      "idempotency_key"
    );
    const normalized = normalizeObservedEvidencePayload(
      input.evidenceType,
      input.payload
    );

    return this.ports.transactions.run(() => {
      const project = this.ports.projects.findById(input.projectId);
      if (!project || project.lifecycleStatus !== "active") {
        throw new ApplicationError("NOT_FOUND", "Project was not found.", {
          projectId: input.projectId
        });
      }
      this.requireActiveRepository(project.id, input.repositoryId);
      const existing =
        this.ports.observedEvidence.findByProjectIdempotencyKey(
          project.id,
          idempotencyKey
        );
      if (existing) {
        if (
          existing.repositoryId !== input.repositoryId ||
          existing.evidenceType !== input.evidenceType ||
          existing.payloadHash !== normalized.payloadHash
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "Observed evidence idempotency key was reused with different evidence identity or payload.",
            {
              existingObservedEvidenceId: existing.id,
              existingRepositoryId: existing.repositoryId,
              submittedRepositoryId: input.repositoryId,
              existingEvidenceType: existing.evidenceType,
              submittedEvidenceType: input.evidenceType,
              existingPayloadHash: existing.payloadHash,
              submittedPayloadHash: normalized.payloadHash
            }
          );
        }
        return { observedEvidence: existing, created: false };
      }

      const evidence: ObservedEvidence = {
        id: this.options.idFactory(),
        projectId: project.id,
        repositoryId: input.repositoryId,
        evidenceType: input.evidenceType,
        idempotencyKey,
        payloadHash: normalized.payloadHash,
        payload: normalized.payload,
        lifecycleStatus: "active",
        createdAt: now
      };
      const audit = this.newAuditEntry({
        projectId: project.id,
        action: "observed_evidence.recorded",
        entityType: "observed_evidence",
        entityId: evidence.id,
        afterSummary: { observedEvidence: evidence },
        createdAt: now
      });
      this.ports.observedEvidence.insert(evidence, normalized.canonicalJson);
      this.ports.auditLog.append(audit);
      return { observedEvidence: evidence, created: true, auditLogId: audit.id };
    });
  }

  submitResult(input: {
    implementationBriefId: string;
    supersedesImplementationResultId?: string | null;
    observedEvidenceIds: string[];
    summary: string;
    criterionVerdicts: CriterionVerdictInput[];
    unfinishedItems: string[];
  }) {
    const now = this.options.clock().toISOString();
    return this.ports.transactions.run(() => {
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
      const source = this.requireBriefSource(brief);
      const observedEvidenceIds = normalizeStringSet(
        input.observedEvidenceIds,
        "observed_evidence_ids"
      );
      this.requireResultEvidence(source.repository.id, observedEvidenceIds);
      const supersedesImplementationResultId = normalizeOptionalText(
        input.supersedesImplementationResultId
      );
      this.requireSupersededResult(
        supersedesImplementationResultId,
        source.target.id
      );
      const staleReasons = this.findSubmissionStaleReasons(brief, source);
      const staleAtSubmission = staleReasons.length > 0;
      const resultId = this.options.idFactory();
      const verdicts = this.normalizeCriterionVerdicts(
        resultId,
        source.revision,
        input.criterionVerdicts,
        observedEvidenceIds,
        now
      );
      const result: ImplementationResult = {
        id: resultId,
        projectId: brief.projectId,
        implementationBriefId: brief.id,
        implementationTargetId: source.target.id,
        ticketRevisionId: source.revision.id,
        supersedesImplementationResultId,
        result: {
          summary: normalizeRequiredString(input.summary, "summary"),
          unfinished_items: normalizeStringSet(
            input.unfinishedItems,
            "unfinished_items"
          ),
          submission_disposition: staleAtSubmission
            ? "stale_archived"
            : "reviewable"
        },
        reviewStatus: "draft",
        lifecycleStatus: staleAtSubmission ? "archived" : "active",
        staleAtSubmission,
        staleReasons,
        createdAt: now,
        updatedAt: now,
        archivedAt: staleAtSubmission ? now : null
      };
      const audit = this.newAuditEntry({
        projectId: brief.projectId,
        action: "implementation_result.submitted",
        entityType: "implementation_result",
        entityId: result.id,
        afterSummary: {
          implementationResult: result,
          observedEvidenceIds,
          criterionVerdicts: verdicts
        },
        createdAt: now
      });
      this.ports.implementationResults.insert(
        result,
        observedEvidenceIds,
        verdicts
      );
      this.ports.auditLog.append(audit);
      return {
        implementationResult: result,
        observedEvidenceIds,
        criterionVerdicts: verdicts,
        auditLogId: audit.id
      };
    });
  }

  private requireBriefSource(brief: ImplementationBrief): BriefSource {
    const target = this.requireImplementationTarget(brief.implementationTargetId);
    const ticket = this.requireTicket(target.ticketId);
    const revision = this.ports.ticketRevisions.findById(
      brief.ticketRevisionId
    );
    if (!revision || revision.projectId !== brief.projectId) {
      throw staleHandoff("ticket_revision_not_found", {
        implementationBriefId: brief.id,
        ticketRevisionId: brief.ticketRevisionId
      });
    }
    const repository = this.ports.repositories.findById(target.repositoryId);
    if (!repository || repository.projectId !== brief.projectId) {
      throw validationError("Implementation Target Repository was not found.");
    }
    const productBriefVersion = this.requireProductBriefVersion(
      brief.productBriefVersionId,
      brief.projectId
    );
    return { target, ticket, revision, repository, productBriefVersion };
  }

  private findSubmissionStaleReasons(
    brief: ImplementationBrief,
    source: BriefSource
  ) {
    const reasons: string[] = [];
    const sources = {
      project: this.ports.projects.findById(brief.projectId),
      implementation_target: source.target,
      ticket: source.ticket,
      repository: source.repository,
      product_brief_version: source.productBriefVersion
    };
    for (const [name, entity] of Object.entries(sources)) {
      if (!entity || entity.lifecycleStatus !== "active") {
        reasons.push(`${name}_archived`);
      }
    }
    if (brief.lifecycleStatus !== "active") {
      reasons.push("implementation_brief_archived");
    }
    if (brief.reviewStatus !== "approved") {
      reasons.push("implementation_brief_not_approved");
    }
    const snapshot = this.ports.repositoryContextSnapshots.findById(
      brief.repositoryContextSnapshotId
    );
    if (!snapshot) {
      reasons.push("repository_context_snapshot_not_found");
      return reasons;
    }
    const sourceProblem = evaluateImplementationFreshness(
      this.ports,
      source.ticket,
      source.revision,
      snapshot,
      {
        commitSha: snapshot.baselineCommitSha ?? "",
        dirtyStateFingerprint: snapshot.dirtyStateFingerprint
      },
      { skipRepositoryState: true }
    );
    if (sourceProblem) {
      reasons.push(sourceProblem.reason);
    }
    return [...new Set(reasons)];
  }

  private requireResultEvidence(
    repositoryId: string,
    observedEvidenceIds: string[]
  ) {
    for (const observedEvidenceId of observedEvidenceIds) {
      const evidence = this.ports.observedEvidence.findById(
        observedEvidenceId
      );
      if (
        !evidence ||
        evidence.repositoryId !== repositoryId
      ) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Observed Evidence must exist in the Implementation Target Repository.",
          { observedEvidenceId, repositoryId }
        );
      }
    }
  }

  private requireSupersededResult(
    supersedesImplementationResultId: string | null,
    implementationTargetId: string
  ) {
    if (!supersedesImplementationResultId) {
      return;
    }
    const superseded = this.ports.implementationResults.findById(
      supersedesImplementationResultId
    );
    if (
      !superseded ||
      superseded.implementationTargetId !== implementationTargetId ||
      superseded.reviewStatus !== "approved" ||
      superseded.lifecycleStatus !== "active"
    ) {
      throw new ApplicationError(
        "CONFLICT",
        "Superseded Implementation Result must be the same Target's active approved Result.",
        { implementationTargetId, supersedesImplementationResultId }
      );
    }
  }

  private normalizeCriterionVerdicts(
    implementationResultId: string,
    revision: TicketRevision,
    inputVerdicts: CriterionVerdictInput[],
    observedEvidenceIds: string[],
    createdAt: string
  ): AcceptanceCriterionVerdict[] {
    const criteria = revision.specification.acceptance_criteria;
    const byCriterion = new Map(
      inputVerdicts.map(verdict => [verdict.acceptanceCriterionId, verdict])
    );
    if (byCriterion.size !== inputVerdicts.length) {
      throw validationError("criterion_verdicts must not contain duplicates.");
    }
    const criterionIds = new Set(criteria.map(criterion => criterion.id));
    for (const verdict of inputVerdicts) {
      if (!criterionIds.has(verdict.acceptanceCriterionId)) {
        throw validationError("criterion_verdicts contains an unknown acceptance criterion.");
      }
      if (verdict.verdict !== "satisfied" && verdict.verdict !== "unsatisfied") {
        throw validationError("Submission verdict must be satisfied or unsatisfied.");
      }
      const allowedKeys = new Set(["acceptanceCriterionId", "verdict", "reason", "evidenceIds"]);
      if (Object.keys(verdict).some(key => !allowedKeys.has(key))) {
        throw validationError("criterion_verdicts contains an undeclared field.");
      }
    }
    const evidenceSet = new Set(observedEvidenceIds);
    return criteria.map(criterion => {
      const input = byCriterion.get(criterion.id);
      if (!input) {
        throw validationError("Each acceptance criterion must have a verdict.");
      }
      const evidenceIds = normalizeStringSet(
        input.evidenceIds,
        "criterion_verdicts.evidence_ids"
      );
      for (const evidenceId of evidenceIds) {
        if (!evidenceSet.has(evidenceId)) {
          throw validationError(
            "criterion_verdicts.evidence_ids must be a subset of observed_evidence_ids."
          );
        }
      }
      return {
        id: this.options.idFactory(),
        implementationResultId,
        acceptanceCriterionId: criterion.id,
        verdict: input.verdict,
        reason: normalizeRequiredString(input.reason, "criterion_verdicts.reason"),
        evidenceIds,
        createdAt
      };
    });
  }

  private requireImplementationTarget(
    implementationTargetId: string
  ): ImplementationTarget {
    const target = this.ports.implementationTargets.findById(
      implementationTargetId
    );
    if (!target) {
      throw new ApplicationError(
        "NOT_FOUND",
        "Implementation Target was not found.",
        { implementationTargetId }
      );
    }
    return target;
  }

  private requireTicket(ticketId: string): Ticket {
    const ticket = this.ports.tickets.findById(ticketId);
    if (!ticket) {
      throw new ApplicationError("NOT_FOUND", "Ticket was not found.", {
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
      !repository ||
      repository.projectId !== projectId ||
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
      !version ||
      version.projectId !== projectId ||
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

function normalizeStringSet(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array.`);
  }
  return [...new Set(value.map(item => normalizeRequiredString(item, field)))];
}
