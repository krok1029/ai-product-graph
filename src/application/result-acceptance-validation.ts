import { ApplicationError } from "../domain/errors.js";
import type { ImplementationResult, TicketRevision } from "../domain/models.js";
import { evaluateImplementationFreshness } from "./implementation-freshness.js";
import { staleHandoff, validationError } from "./implementation-workflow-helpers.js";
import type { ApplicationPorts } from "./ports.js";

export function requireAcceptanceSource(ports: ApplicationPorts, result: ImplementationResult) {
  if (result.lifecycleStatus !== "active" || result.reviewStatus !== "draft" ||
      result.staleAtSubmission || ports.resultAcceptances.findByResultId(result.id)) {
    throw new ApplicationError("CONFLICT", "Result must be an unaccepted active draft.");
  }
  const target = ports.implementationTargets.findById(result.implementationTargetId);
  const ticket = target && ports.tickets.findById(target.ticketId);
  const revision = ports.ticketRevisions.findById(result.ticketRevisionId);
  const brief = ports.implementationBriefs.findById(result.implementationBriefId);
  const productBriefVersion = brief && ports.productBriefVersions.findById(brief.productBriefVersionId);
  const repository = target && ports.repositories.findById(target.repositoryId);
  const project = ports.projects.findById(result.projectId);
  const snapshot = brief && ports.repositoryContextSnapshots.findById(brief.repositoryContextSnapshotId);
  if (!target || !ticket || !revision || !brief || !repository || !project || !snapshot || !productBriefVersion ||
      [target, ticket, repository, project, brief, productBriefVersion].some(entity => entity.lifecycleStatus !== "active") ||
      [target, ticket, revision, brief, repository, snapshot, productBriefVersion].some(entity => entity.projectId !== result.projectId) ||
      brief.reviewStatus !== "approved" || productBriefVersion.reviewStatus !== "approved" ||
      brief.implementationTargetId !== target.id || brief.ticketRevisionId !== revision.id ||
      revision.ticketId !== ticket.id || snapshot.repositoryId !== repository.id ||
      !revision.requiredTargets.some(required => required.repository_id === repository.id)) {
    throw staleHandoff("implementation_result_source_invalid", { implementationResultId: result.id });
  }
  const problem = evaluateImplementationFreshness(ports, ticket, revision, snapshot,
    { commitSha: snapshot.baselineCommitSha ?? "" }, { skipRepositoryState: true });
  if (problem) throw staleHandoff(problem.reason, problem.details);
  const current = ports.implementationResults.findActiveApprovedByTargetId(target.id);
  if (current && result.supersedesImplementationResultId !== current.id) {
    throw new ApplicationError("CONFLICT", "Result must explicitly supersede the active approved Result.");
  }
  if (result.supersedesImplementationResultId && current?.id !== result.supersedesImplementationResultId) {
    throw new ApplicationError("CONFLICT", "Superseded Result is no longer active approved.");
  }
  return { target, ticket, revision, current };
}

export function requireAcceptanceVerdicts(
  ports: ApplicationPorts,
  result: ImplementationResult,
  revision: TicketRevision,
  repositoryId: string,
  waivers: Array<{ acceptanceCriterionId: string; reason: string }>
) {
  const verdicts = ports.implementationResults.listVerdicts(result.id);
  const byCriterion = new Map(verdicts.map(verdict => [verdict.acceptanceCriterionId, verdict]));
  const criteria = revision.specification.acceptance_criteria;
  const waived = new Map(waivers.map(waiver => [waiver.acceptanceCriterionId, waiver.reason]));
  if (waived.size !== waivers.length) throw validationError("Waivers must not repeat a criterion.");
  if (verdicts.length !== criteria.length || byCriterion.size !== criteria.length) {
    throw validationError("Every criterion must have exactly one submitted verdict.");
  }
  for (const waiver of waivers) {
    if (!criteria.some(criterion => criterion.id === waiver.acceptanceCriterionId) ||
        byCriterion.get(waiver.acceptanceCriterionId)?.verdict !== "unsatisfied") {
      throw validationError("Waivers may only reference unsatisfied criteria in this revision.");
    }
  }
  const evidenceIds = ports.implementationResults.listEvidenceIds(result.id);
  const evidenceSet = new Set(evidenceIds);
  for (const id of evidenceIds) {
    const evidence = ports.observedEvidence.findById(id);
    if (!evidence || evidence.projectId !== result.projectId || evidence.repositoryId !== repositoryId) {
      throw validationError("Result evidence must belong to its Project and Repository.");
    }
  }
  return criteria.map(criterion => {
    const verdict = byCriterion.get(criterion.id);
    if (!verdict || verdict.implementationResultId !== result.id || !verdict.reason?.trim() ||
        verdict.evidenceIds.some(id => !evidenceSet.has(id))) {
      throw validationError("Submitted verdict requires a reason and valid result evidence references.");
    }
    if (verdict.verdict === "satisfied") {
      if (verdict.evidenceIds.length === 0) throw validationError("Satisfied verdict requires supporting evidence.");
    } else if (verdict.verdict !== "unsatisfied" || !waived.has(criterion.id)) {
      throw validationError("Each unsatisfied criterion requires an explicit waiver.");
    }
    return { verdict, waiverReason: waived.get(criterion.id) };
  });
}
