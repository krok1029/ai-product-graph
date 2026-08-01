// MCP response 序列化工具。
//
// 把 camelCase domain models 轉成 snake_case MCP response contract。Domain
// objects 不在這裡改變；這個 module 只塑造 transport representation。

import type {
  GraphDraftBatch,
  GraphEdge,
  GraphNode,
  GraphRevision,
  ImplementationBrief,
  ImplementationTarget,
  Idea,
  ProductBrief,
  ProductBriefVersion,
  Project,
  Repository,
  RepositoryContextSnapshot,
  Ticket,
  TicketDraftBatch,
  TicketRevision
} from "../../domain/models.js";

export function serializeProject(project: Project) {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    lifecycle_status: project.lifecycleStatus,
    current_product_brief_id: project.currentProductBriefId,
    current_graph_revision_id: project.currentGraphRevisionId,
    last_reconciled_product_brief_version_id:
      project.lastReconciledProductBriefVersionId,
    product_intent_graph_revision_id: project.productIntentGraphRevisionId,
    created_at: project.createdAt,
    updated_at: project.updatedAt
  };
}

export function serializeIdea(idea: Idea) {
  return {
    id: idea.id,
    project_id: idea.projectId,
    slug: idea.slug,
    content: idea.content,
    source: idea.source,
    lifecycle_status: idea.lifecycleStatus,
    created_at: idea.createdAt,
    updated_at: idea.updatedAt
  };
}

export function serializeProductBrief(productBrief: ProductBrief) {
  return {
    id: productBrief.id,
    project_id: productBrief.projectId,
    source_idea_id: productBrief.sourceIdeaId,
    slug: productBrief.slug,
    current_approved_version_id: productBrief.currentApprovedVersionId,
    lifecycle_status: productBrief.lifecycleStatus,
    created_at: productBrief.createdAt,
    updated_at: productBrief.updatedAt
  };
}

export function serializeProductBriefVersion(version: ProductBriefVersion) {
  return {
    id: version.id,
    product_brief_id: version.productBriefId,
    project_id: version.projectId,
    version_number: version.versionNumber,
    base_approved_version_id: version.baseApprovedVersionId,
    brief: version.brief,
    review_status: version.reviewStatus,
    lifecycle_status: version.lifecycleStatus,
    approved_by_actor_id: version.approvedByActorId,
    approved_at: version.approvedAt,
    created_at: version.createdAt,
    updated_at: version.updatedAt
  };
}

export function serializeGraphDraftBatch(batch: GraphDraftBatch) {
  return {
    id: batch.id,
    project_id: batch.projectId,
    source_product_brief_version_id:
      batch.sourceProductBriefVersionId,
    base_graph_revision_id: batch.baseGraphRevisionId,
    reconciliation_summary: batch.reconciliationSummary,
    review_status: batch.reviewStatus,
    lifecycle_status: batch.lifecycleStatus,
    approved_by_actor_id: batch.approvedByActorId,
    approved_at: batch.approvedAt,
    created_at: batch.createdAt,
    updated_at: batch.updatedAt
  };
}

export function serializeGraphRevision(revision: GraphRevision) {
  return {
    id: revision.id,
    project_id: revision.projectId,
    graph_draft_batch_id: revision.graphDraftBatchId,
    source_product_brief_version_id:
      revision.sourceProductBriefVersionId,
    sequence_number: revision.sequenceNumber,
    is_noop_reconciliation: revision.isNoopReconciliation,
    reconciliation_summary: revision.reconciliationSummary,
    created_at: revision.createdAt
  };
}

export function serializeGraphNode(node: GraphNode) {
  return {
    id: node.id,
    project_id: node.projectId,
    slug: node.slug,
    type: node.type,
    title: node.title,
    description: node.description,
    source: node.source,
    source_ref_type: node.sourceRefType,
    source_ref_id: node.sourceRefId,
    lifecycle_status: node.lifecycleStatus,
    created_in_graph_revision_id: node.createdInGraphRevisionId,
    last_changed_in_graph_revision_id:
      node.lastChangedInGraphRevisionId,
    metadata: node.metadata,
    created_at: node.createdAt,
    updated_at: node.updatedAt
  };
}

export function serializeGraphEdge(edge: GraphEdge) {
  return {
    id: edge.id,
    project_id: edge.projectId,
    source_node_id: edge.sourceNodeId,
    target_node_id: edge.targetNodeId,
    relation_type: edge.relationType,
    confidence: edge.confidence,
    lifecycle_status: edge.lifecycleStatus,
    created_in_graph_revision_id: edge.createdInGraphRevisionId,
    last_changed_in_graph_revision_id:
      edge.lastChangedInGraphRevisionId,
    metadata: edge.metadata,
    created_at: edge.createdAt,
    updated_at: edge.updatedAt
  };
}

export function serializeTicketDraftBatch(batch: TicketDraftBatch) {
  return {
    id: batch.id,
    project_id: batch.projectId,
    source_graph_revision_id: batch.sourceGraphRevisionId,
    lifecycle_status: batch.lifecycleStatus,
    created_at: batch.createdAt,
    updated_at: batch.updatedAt
  };
}

export function serializeTicket(ticket: Ticket) {
  return {
    id: ticket.id,
    project_id: ticket.projectId,
    slug: ticket.slug,
    title: ticket.title,
    current_approved_revision_id: ticket.currentApprovedRevisionId,
    lifecycle_status: ticket.lifecycleStatus,
    delivery_status: ticket.deliveryStatus,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt
  };
}

export function serializeTicketRevision(revision: TicketRevision) {
  return {
    id: revision.id,
    ticket_id: revision.ticketId,
    project_id: revision.projectId,
    ticket_draft_batch_id: revision.ticketDraftBatchId,
    revision_number: revision.revisionNumber,
    base_approved_revision_id: revision.baseApprovedRevisionId,
    source_graph_revision_id: revision.sourceGraphRevisionId,
    title: revision.title,
    specification: revision.specification,
    required_targets: revision.requiredTargets,
    review_status: revision.reviewStatus,
    lifecycle_status: revision.lifecycleStatus,
    approved_by_actor_id: revision.approvedByActorId,
    approved_at: revision.approvedAt,
    created_at: revision.createdAt,
    updated_at: revision.updatedAt
  };
}

export function serializeImplementationTarget(
  target: ImplementationTarget&{ identityAction?: "created" | "reused" }
) {
  return {
    id: target.id,
    project_id: target.projectId,
    ticket_id: target.ticketId,
    repository_id: target.repositoryId,
    lifecycle_status: target.lifecycleStatus,
    identity_action: target.identityAction,
    created_at: target.createdAt,
    updated_at: target.updatedAt
  };
}

export function serializeRepository(repository: Repository) {
  return {
    id: repository.id,
    project_id: repository.projectId,
    slug: repository.slug,
    name: repository.name,
    root_path: repository.rootPath,
    remote_url: repository.remoteUrl,
    lifecycle_status: repository.lifecycleStatus,
    created_at: repository.createdAt,
    updated_at: repository.updatedAt
  };
}

export function serializeRepositoryContextSnapshot(
  snapshot: RepositoryContextSnapshot
) {
  return {
    id: snapshot.id,
    project_id: snapshot.projectId,
    repository_id: snapshot.repositoryId,
    baseline_commit_sha: snapshot.baselineCommitSha,
    dirty_state_fingerprint: snapshot.dirtyStateFingerprint,
    context: snapshot.context,
    is_approvable: snapshot.isApprovable,
    created_at: snapshot.createdAt
  };
}

export function serializeImplementationBrief(brief: ImplementationBrief) {
  return {
    id: brief.id,
    project_id: brief.projectId,
    implementation_target_id: brief.implementationTargetId,
    ticket_revision_id: brief.ticketRevisionId,
    product_brief_version_id: brief.productBriefVersionId,
    repository_context_snapshot_id: brief.repositoryContextSnapshotId,
    supersedes_implementation_brief_id:
      brief.supersedesImplementationBriefId,
    slug: brief.slug,
    brief: brief.brief,
    review_status: brief.reviewStatus,
    lifecycle_status: brief.lifecycleStatus,
    approved_by_actor_id: brief.approvedByActorId,
    approved_at: brief.approvedAt,
    created_at: brief.createdAt,
    updated_at: brief.updatedAt
  };
}
