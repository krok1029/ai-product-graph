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
  const project = ports.projects.findById(ticket.projectId);
  const productBrief = ports.productBriefs.findByProjectId(ticket.projectId);
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
  const sourceProblem = findTicketSourceProblem(ports, ticket, revision);
  if (sourceProblem) {
    return sourceProblem;
  }
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
  if (
    revision.ticketId !== ticket.id ||
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
  for (const nodeId of ports.ticketRevisions.listGraphNodeIds(revision.id)) {
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
    const changedAfterSource = node.lastChangedInGraphRevisionId === null ? null : isGraphRevisionAfter(
      ports,
      node.lastChangedInGraphRevisionId,
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
