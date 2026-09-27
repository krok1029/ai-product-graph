// Handoff 專用的來源鏈驗證；既有來源無法驗證時阻擋交接，不改變 draft／approval 契約。
import type { ImplementationBrief, LifecycleStatus } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import { isRepositoryContextApprovable, staleHandoff } from "./implementation-workflow-helpers.js";

export function requireHandoffSource(ports: ApplicationPorts, brief: ImplementationBrief) {
  const projectId = brief.projectId;
  const project = requireActive(ports.projects.findById(projectId), "project", { projectId });
  const productBrief = requireActive(ports.productBriefs.findByProjectId(projectId),
    "product_brief", { projectId });
  requireIdentity(productBrief.projectId === projectId, "product_brief", { productBriefId: productBrief.id });
  if (project.lastReconciledProductBriefVersionId === productBrief.currentApprovedVersionId &&
      productBrief.currentApprovedVersionId) {
    const reconciled = project.productIntentGraphRevisionId &&
      ports.graphRevisions.findById(project.productIntentGraphRevisionId);
    if (!reconciled || reconciled.projectId !== projectId ||
        reconciled.sourceProductBriefVersionId !== productBrief.currentApprovedVersionId) {
      throw staleHandoff("product_intent_reconciliation_unverifiable", { projectId,
        productIntentGraphRevisionId: project.productIntentGraphRevisionId });
    }
  }
  const target = requireActive(ports.implementationTargets.findById(brief.implementationTargetId),
    "implementation_target", { implementationTargetId: brief.implementationTargetId });
  requireIdentity(target.projectId === projectId, "implementation_target", { implementationTargetId: target.id });
  const ticket = requireActive(ports.tickets.findById(target.ticketId), "ticket", { ticketId: target.ticketId });
  requireIdentity(ticket.projectId === projectId, "ticket", { ticketId: ticket.id });
  const revision = requireActive(ports.ticketRevisions.findById(brief.ticketRevisionId),
    "ticket_revision", { ticketRevisionId: brief.ticketRevisionId });
  requireIdentity(revision.projectId === projectId && revision.ticketId === ticket.id,
    "ticket_revision", { ticketRevisionId: revision.id, ticketId: ticket.id });
  if (!revision.requiredTargets.some(required => required.repository_id === target.repositoryId)) {
    throw staleHandoff("implementation_target_not_required", { implementationTargetId: target.id, ticketRevisionId: revision.id });
  }
  const repository = requireActive(ports.repositories.findById(target.repositoryId),
    "repository", { repositoryId: target.repositoryId });
  requireIdentity(repository.projectId === projectId, "repository", { repositoryId: repository.id });
  const productBriefVersion = requireVersion(brief.productBriefVersionId);
  requireVersion(productBrief.currentApprovedVersionId);
  const graphRevision = ports.graphRevisions.findById(revision.sourceGraphRevisionId);
  if (!graphRevision) {
    throw staleHandoff("graph_revision_not_found", { graphRevisionId: revision.sourceGraphRevisionId });
  }
  requireIdentity(graphRevision.projectId === projectId &&
    graphRevision.sourceProductBriefVersionId === productBriefVersion.id,
  "graph_revision", { graphRevisionId: graphRevision.id });
  const snapshot = ports.repositoryContextSnapshots.findById(brief.repositoryContextSnapshotId);
  if (!snapshot) {
    throw staleHandoff("repository_context_snapshot_not_found", { repositoryContextSnapshotId: brief.repositoryContextSnapshotId });
  }
  requireIdentity(snapshot.projectId === projectId && snapshot.repositoryId === repository.id,
    "repository_context_snapshot", { repositoryContextSnapshotId: snapshot.id, repositoryId: repository.id });
  if (!snapshot.isApprovable || !isRepositoryContextApprovable(snapshot.baselineCommitSha,
    snapshot.context.has_uncommitted_changes, snapshot.dirtyStateFingerprint)) {
    throw staleHandoff("repository_context_snapshot_unverifiable", { repositoryContextSnapshotId: snapshot.id });
  }
  return { target, ticket, revision, repository, productBriefVersion, snapshot };

  function requireVersion(versionId: string | null) {
    const version = requireActive(versionId ? ports.productBriefVersions.findById(versionId) : null,
      "product_brief_version", { productBriefVersionId: versionId });
    requireIdentity(version.projectId === projectId && version.productBriefId === productBrief.id,
      "product_brief_version", { productBriefVersionId: version.id });
    if (version.reviewStatus !== "approved") {
      throw staleHandoff("product_brief_version_not_approved", { productBriefVersionId: version.id });
    }
    return version;
  }
}

function requireActive<T extends { lifecycleStatus: LifecycleStatus }>(
  entity: T | null, source: string, details: Record<string, unknown>
): T {
  if (!entity) throw staleHandoff(`${source}_not_found`, details);
  if (entity.lifecycleStatus !== "active") throw staleHandoff(`${source}_archived`, details);
  return entity;
}

function requireIdentity(matches: boolean, source: string, details: Record<string, unknown>) {
  if (!matches) throw staleHandoff(`${source}_identity_mismatch`, details);
}
