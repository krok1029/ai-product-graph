// Implementation source freshness evaluator。
//
// Handoff、Result submission 與後續 Result Acceptance 都需要同一套來源新鮮度
// 規則。這個 module 把 product intent reconciliation、Ticket Revision、
// graph node 與 dependency 檢查集中，避免各 workflow 各自重建 stale 判斷。

import type {
  RepositoryContextSnapshot,
  Ticket,
  TicketRevision
} from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import { planningChain } from "./planning-lineage.js";
import { planningContentRevision } from "./planning-content-revision.js";
import {
  normalizeOptionalText,
  normalizeRequiredString
} from "./implementation-workflow-helpers.js";

export type ImplementationStaleReason = {
  reason: string;
  details: Record<string, unknown>;
};

export function evaluateImplementationFreshness(
  ports: ApplicationPorts,
  ticket: Ticket,
  revision: TicketRevision,
  snapshot: RepositoryContextSnapshot,
  currentRepositoryState: {
    commitSha: string;
    dirtyStateFingerprint?: string | null;
  },
  options: { skipRepositoryState?: boolean } = {}
): ImplementationStaleReason | null {
  const sourceProblem = evaluateTicketSourceFreshness(ports, ticket, revision);
  if (sourceProblem) return sourceProblem;
  if (options.skipRepositoryState === true) {
    return null;
  }
  const commitSha = normalizeRequiredString(
    currentRepositoryState.commitSha,
    "current_repository_state.commit_sha"
  );
  if (snapshot.baselineCommitSha !== commitSha) {
    return {
      reason: "repository_baseline_mismatch",
      details: {
        repositoryContextSnapshotId: snapshot.id,
        expectedCommitSha: snapshot.baselineCommitSha,
        currentCommitSha: commitSha
      }
    };
  }
  const dirtyStateFingerprint = normalizeOptionalText(
    currentRepositoryState.dirtyStateFingerprint
  );
  if (snapshot.dirtyStateFingerprint !== dirtyStateFingerprint) {
    return {
      reason: "repository_dirty_state_mismatch",
      details: {
        repositoryContextSnapshotId: snapshot.id,
        expectedDirtyStateFingerprint: snapshot.dirtyStateFingerprint,
        currentDirtyStateFingerprint: dirtyStateFingerprint
      }
    };
  }
  return null;
}

export function evaluateTicketSourceFreshness(
  ports: ApplicationPorts,
  ticket: Ticket,
  revision: TicketRevision
): ImplementationStaleReason | null {
  const project = ports.projects.findById(ticket.projectId);
  const productBrief = ports.productBriefs.findByProjectId(ticket.projectId);
  if (project && project.lifecycleStatus !== "active") {
    return { reason: "project_archived", details: { projectId: project.id } };
  }
  if (productBrief && productBrief.lifecycleStatus !== "active") {
    return { reason: "product_brief_archived", details: { productBriefId: productBrief.id } };
  }
  if (
    !project ||
    !productBrief ||
    project.lastReconciledProductBriefVersionId !==
    productBrief.currentApprovedVersionId
  ) {
    return {
      reason: "product_intent_unreconciled",
      details: {
        projectId: ticket.projectId,
        currentProductBriefVersionId:
          productBrief?.currentApprovedVersionId ?? null,
        lastReconciledProductBriefVersionId:
          project?.lastReconciledProductBriefVersionId ?? null
      }
    };
  }
  if (ticket.currentApprovedRevisionId !== revision.id) {
    return {
      reason: "ticket_revision_not_current",
      details: {
        ticketId: ticket.id,
        currentApprovedRevisionId: ticket.currentApprovedRevisionId,
        briefTicketRevisionId: revision.id
      }
    };
  }
  return findTicketSourceProblem(ports, ticket, revision);
}

function findTicketSourceProblem(
  ports: ApplicationPorts,
  ticket: Ticket,
  revision: TicketRevision,
  visitedTicketIds = new Set<string>()
): ImplementationStaleReason | null {
  if (visitedTicketIds.has(ticket.id)) {
    return null;
  }
  visitedTicketIds.add(ticket.id);
  // 採用階層後，舊 Ticket 不能因 Brief 根節點自動對齊而繞過來源補全。
  if (!revision.specification.source_spec_id && ports.graphNodes.list(ticket.projectId, "active")
    .some(node => node.type === "product_brief")) {
    return { reason: "planning_source_missing", details: { ticketId: ticket.id, ticketRevisionId: revision.id } };
  }
  if (
    revision.ticketId !== ticket.id ||
    revision.projectId !== ticket.projectId ||
    revision.reviewStatus !== "approved" ||
    revision.lifecycleStatus !== "active"
  ) {
    return {
      reason: "ticket_revision_not_active_approved",
      details: {
        ticketId: ticket.id,
        ticketRevisionId: revision.id,
        reviewStatus: revision.reviewStatus,
        lifecycleStatus: revision.lifecycleStatus
      }
    };
  }
  const nodeIds = ports.ticketRevisions.listGraphNodeIds(revision.id);
  const reconciledAncestors = new Set<string>();
  if (revision.specification.source_spec_id) {
    try {
      const chain = planningChain(ports, ticket.projectId, revision.specification.source_spec_id);
      if (chain[0]?.type !== "spec" || chain.some(node => !nodeIds.includes(node.id))) {
        return { reason: "planning_source_changed", details: { ticketId: ticket.id, ticketRevisionId: revision.id } };
      }
      // 完整來源鏈已確認後，上游的改動由 Spec 承接；Ticket 只因實際內容變更而失效。
      for (const ancestor of chain.slice(1)) reconciledAncestors.add(ancestor.id);
    } catch {
      return { reason: "planning_source_unreconciled", details: { ticketId: ticket.id,
        ticketRevisionId: revision.id, graphNodeId: revision.specification.source_spec_id } };
    }
  }
  for (const nodeId of nodeIds) {
    const node = ports.graphNodes.findById(nodeId);
    if (!node || node.projectId !== revision.projectId) {
      return {
        reason: "graph_node_not_found",
        details: { ticketRevisionId: revision.id, graphNodeId: nodeId }
      };
    }
    if (node.lifecycleStatus !== "active") {
      return {
        reason: "graph_node_archived",
        details: { ticketRevisionId: revision.id, graphNodeId: node.id }
      };
    }
    if (reconciledAncestors.has(nodeId)) continue;
    const contentRevisionId = planningContentRevision(node);
    const changedAfterSource = contentRevisionId === null ? null : isGraphRevisionAfter(
      ports,
      contentRevisionId,
      revision.sourceGraphRevisionId
    );
    if (changedAfterSource === null) {
      return {
        reason: "graph_revision_not_found",
        details: {
          ticketRevisionId: revision.id,
          graphNodeId: node.id,
          sourceGraphRevisionId: revision.sourceGraphRevisionId,
          lastChangedInGraphRevisionId: node.lastChangedInGraphRevisionId
        }
      };
    }
    if (changedAfterSource) {
      return {
        reason: "graph_node_changed",
        details: {
          ticketRevisionId: revision.id,
          graphNodeId: node.id,
          sourceGraphRevisionId: revision.sourceGraphRevisionId,
          lastChangedInGraphRevisionId: node.lastChangedInGraphRevisionId
        }
      };
    }
  }
  for (const dependencyId of ports.ticketRevisions.listDependencyTicketIds(
    revision.id
  )) {
    const dependency = ports.tickets.findById(dependencyId);
    if (
      !dependency ||
      dependency.projectId !== ticket.projectId ||
      dependency.lifecycleStatus !== "active" ||
      !dependency.currentApprovedRevisionId
    ) {
      return {
        reason: "ticket_dependency_not_current",
        details: {
          ticketRevisionId: revision.id,
          dependencyTicketId: dependencyId
        }
      };
    }
    const dependencyRevision = ports.ticketRevisions.findById(
      dependency.currentApprovedRevisionId
    );
    if (!dependencyRevision) {
      return {
        reason: "ticket_dependency_not_current",
        details: {
          ticketRevisionId: revision.id,
          dependencyTicketId: dependencyId
        }
      };
    }
    const dependencyProblem = findTicketSourceProblem(
      ports,
      dependency,
      dependencyRevision,
      visitedTicketIds
    );
    if (dependencyProblem) {
      return {
        reason: "ticket_dependency_stale",
        details: {
          ticketRevisionId: revision.id,
          dependencyTicketId: dependencyId,
          dependencyStaleReason: dependencyProblem.reason,
          dependencyDetails: dependencyProblem.details
        }
      };
    }
  }
  return null;
}

function isGraphRevisionAfter(
  ports: ApplicationPorts,
  candidateId: string,
  baseId: string
) {
  const candidate = ports.graphRevisions.findById(candidateId);
  const base = ports.graphRevisions.findById(baseId);
  if (!candidate || !base || candidate.projectId !== base.projectId) {
    return null;
  }
  return candidate.sequenceNumber > base.sequenceNumber;
}
