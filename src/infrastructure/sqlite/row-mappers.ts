// SQLite row 轉換器。
//
// 把 SQLite rows 轉成 domain models，並把 JSON parsing 限縮在 persistence
// adapter 內。Repository factories 匯入這些 mappers，讓 SQL 檔案能專注在
// queries 與 writes。

import type {
  AuditLogEntry,
  GraphDraftBatch,
  GraphDraftBatchChange,
  GraphEdge,
  GraphNode,
  GraphRevision,
  AcceptanceCriterionVerdict,
  ImplementationBrief,
  ImplementationBriefJson,
  ImplementationResult,
  ImplementationResultJson,
  ImplementationTarget,
  Idea,
  ObservedEvidence,
  Project,
  ProductBrief,
  ProductBriefJson,
  ProductBriefVersion,
  Repository,
  RepositoryContextJson,
  RepositoryContextSnapshot,
  Ticket,
  TicketDraftBatch,
  TicketRevision
} from "../../domain/models.js";

export type ProjectRow= {
  id: string;
  slug: string;
  name: string;
  description: string|null;
  lifecycle_status: "active" | "archived";
  current_product_brief_id: string|null;
  current_graph_revision_id: string|null;
  last_reconciled_product_brief_version_id: string|null;
  product_intent_graph_revision_id: string|null;
  created_at: string;
  updated_at: string;
};

export type IdeaRow= {
  id: string;
  project_id: string;
  slug: string;
  content: string;
  source: string;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type RepositoryRow= {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  root_path: string|null;
  remote_url: string|null;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type ProductBriefRow= {
  id: string;
  project_id: string;
  source_idea_id: string|null;
  slug: string;
  current_approved_version_id: string|null;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type ProductBriefVersionRow= {
  id: string;
  product_brief_id: string;
  project_id: string;
  version_number: number;
  base_approved_version_id: string|null;
  brief_json: string;
  review_status: "draft" | "approved";
  lifecycle_status: "active" | "archived";
  approved_by_actor_id: string|null;
  approved_at: string|null;
  created_at: string;
  updated_at: string;
};

export type GraphDraftBatchRow= {
  id: string;
  project_id: string;
  source_product_brief_version_id: string;
  base_graph_revision_id: string|null;
  reconciliation_summary: string|null;
  review_status: "draft" | "approved";
  lifecycle_status: "active" | "archived";
  approved_by_actor_id: string|null;
  approved_at: string|null;
  created_at: string;
  updated_at: string;
};

export type GraphDraftBatchChangeRow= {
  id: string;
  graph_draft_batch_id: string;
  project_id: string;
  change_id: string;
  operation: "add" | "update" | "archive";
  entity_kind: "node" | "edge";
  target_id: string|null;
  payload_json: string;
  conflict_json: string|null;
  created_at: string;
};

export type GraphRevisionRow= {
  id: string;
  project_id: string;
  graph_draft_batch_id: string;
  source_product_brief_version_id: string;
  sequence_number: number;
  is_noop_reconciliation: number;
  reconciliation_summary: string|null;
  created_at: string;
};

export type GraphNodeRow= {
  id: string;
  project_id: string;
  slug: string;
  type: GraphNode["type"];
  title: string;
  description: string|null;
  source: string;
  source_ref_type: string|null;
  source_ref_id: string|null;
  lifecycle_status: "active" | "archived";
  created_in_graph_revision_id: string | null;
  last_changed_in_graph_revision_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type GraphEdgeRow= {
  id: string;
  project_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: GraphEdge["relationType"];
  confidence: number|null;
  lifecycle_status: "active" | "archived";
  created_in_graph_revision_id: string | null;
  last_changed_in_graph_revision_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type TicketDraftBatchRow= {
  id: string;
  project_id: string;
  source_graph_revision_id: string;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type TicketRow= {
  id: string;
  project_id: string;
  slug: string;
  title: string;
  current_approved_revision_id: string|null;
  lifecycle_status: "active" | "archived";
  delivery_status: Ticket["deliveryStatus"];
  created_at: string;
  updated_at: string;
};

export type TicketRevisionRow= {
  id: string;
  ticket_id: string;
  project_id: string;
  ticket_draft_batch_id: string|null;
  revision_number: number;
  base_approved_revision_id: string|null;
  source_graph_revision_id: string;
  title: string;
  specification_json: string;
  required_targets_json: string;
  review_status: "draft" | "approved";
  lifecycle_status: "active" | "archived";
  approved_by_actor_id: string|null;
  approved_at: string|null;
  created_at: string;
  updated_at: string;
};

export type ImplementationTargetRow= {
  id: string;
  project_id: string;
  ticket_id: string;
  repository_id: string;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type RepositoryContextSnapshotRow= {
  id: string;
  project_id: string;
  repository_id: string;
  baseline_commit_sha: string|null;
  dirty_state_fingerprint: string|null;
  context_json: string;
  is_approvable: number;
  created_at: string;
};

export type ImplementationBriefRow= {
  id: string;
  project_id: string;
  implementation_target_id: string;
  ticket_revision_id: string;
  product_brief_version_id: string;
  repository_context_snapshot_id: string;
  supersedes_implementation_brief_id: string|null;
  slug: string;
  brief_json: string;
  review_status: "draft" | "approved";
  lifecycle_status: "active" | "archived";
  approved_by_actor_id: string|null;
  approved_at: string|null;
  created_at: string;
  updated_at: string;
};

export type ObservedEvidenceRow= {
  id: string;
  project_id: string;
  repository_id: string;
  evidence_type: ObservedEvidence["evidenceType"];
  idempotency_key: string;
  payload_hash: string;
  payload_json: string;
  lifecycle_status: "active" | "archived";
  created_at: string;
};

export type ImplementationResultRow= {
  id: string;
  project_id: string;
  implementation_brief_id: string;
  implementation_target_id: string;
  ticket_revision_id: string;
  supersedes_implementation_result_id: string|null;
  result_json: string;
  review_status: "draft" | "approved";
  lifecycle_status: "active" | "archived";
  stale_at_submission: number;
  stale_reasons_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string|null;
};

export type AcceptanceCriterionVerdictRow= {
  id: string;
  implementation_result_id: string;
  acceptance_criterion_id: string;
  verdict: "satisfied" | "unsatisfied";
  reason: string;
  evidence_ids_json: string;
  created_at: string;
};

export type AuditRow= {
  id: string;
  project_id: string|null;
  actor_type: "mcp_client" | "system";
  actor_id: string|null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_summary_json: string|null;
  after_summary_json: string|null;
  metadata_json: string;
  created_at: string;
};

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    lifecycleStatus: row.lifecycle_status,
    currentProductBriefId: row.current_product_brief_id,
    currentGraphRevisionId: row.current_graph_revision_id,
    lastReconciledProductBriefVersionId:
      row.last_reconciled_product_brief_version_id,
    productIntentGraphRevisionId: row.product_intent_graph_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapProductBrief(row: ProductBriefRow): ProductBrief {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceIdeaId: row.source_idea_id,
    slug: row.slug,
    currentApprovedVersionId: row.current_approved_version_id,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapProductBriefVersion(
  row: ProductBriefVersionRow
): ProductBriefVersion {
  return {
    id: row.id,
    productBriefId: row.product_brief_id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    baseApprovedVersionId: row.base_approved_version_id,
    brief: JSON.parse(row.brief_json) as ProductBriefJson,
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    approvedByActorId: row.approved_by_actor_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapGraphDraftBatch(row: GraphDraftBatchRow): GraphDraftBatch {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceProductBriefVersionId: row.source_product_brief_version_id,
    baseGraphRevisionId: row.base_graph_revision_id,
    reconciliationSummary: row.reconciliation_summary,
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    approvedByActorId: row.approved_by_actor_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapGraphDraftBatchChange(
  row: GraphDraftBatchChangeRow
): GraphDraftBatchChange {
  return {
    id: row.id,
    graphDraftBatchId: row.graph_draft_batch_id,
    projectId: row.project_id,
    changeId: row.change_id,
    operation: row.operation,
    entityKind: row.entity_kind,
    targetId: row.target_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    conflict: parseOptionalJson(row.conflict_json),
    createdAt: row.created_at
  };
}

export function mapGraphRevision(row: GraphRevisionRow): GraphRevision {
  return {
    id: row.id,
    projectId: row.project_id,
    graphDraftBatchId: row.graph_draft_batch_id,
    sourceProductBriefVersionId: row.source_product_brief_version_id,
    sequenceNumber: row.sequence_number,
    isNoopReconciliation: row.is_noop_reconciliation === 1,
    reconciliationSummary: row.reconciliation_summary,
    createdAt: row.created_at
  };
}

export function mapGraphNode(row: GraphNodeRow): GraphNode {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    description: row.description,
    source: row.source,
    sourceRefType: row.source_ref_type,
    sourceRefId: row.source_ref_id,
    lifecycleStatus: row.lifecycle_status,
    createdInGraphRevisionId: row.created_in_graph_revision_id,
    lastChangedInGraphRevisionId: row.last_changed_in_graph_revision_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapGraphEdge(row: GraphEdgeRow): GraphEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    relationType: row.relation_type,
    confidence: row.confidence,
    lifecycleStatus: row.lifecycle_status,
    createdInGraphRevisionId: row.created_in_graph_revision_id,
    lastChangedInGraphRevisionId: row.last_changed_in_graph_revision_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapIdea(row: IdeaRow): Idea {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    content: row.content,
    source: row.source,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    name: row.name,
    rootPath: row.root_path,
    remoteUrl: row.remote_url,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapTicketDraftBatch(row: TicketDraftBatchRow): TicketDraftBatch {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceGraphRevisionId: row.source_graph_revision_id,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    title: row.title,
    currentApprovedRevisionId: row.current_approved_revision_id,
    lifecycleStatus: row.lifecycle_status,
    deliveryStatus: row.delivery_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapTicketRevision(row: TicketRevisionRow): TicketRevision {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    projectId: row.project_id,
    ticketDraftBatchId: row.ticket_draft_batch_id,
    revisionNumber: row.revision_number,
    baseApprovedRevisionId: row.base_approved_revision_id,
    sourceGraphRevisionId: row.source_graph_revision_id,
    title: row.title,
    specification: JSON.parse(
      row.specification_json
    ) as TicketRevision["specification"],
    requiredTargets: JSON.parse(
      row.required_targets_json
    ) as TicketRevision["requiredTargets"],
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    approvedByActorId: row.approved_by_actor_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapImplementationTarget(
  row: ImplementationTargetRow
): ImplementationTarget {
  return {
    id: row.id,
    projectId: row.project_id,
    ticketId: row.ticket_id,
    repositoryId: row.repository_id,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapRepositoryContextSnapshot(
  row: RepositoryContextSnapshotRow
): RepositoryContextSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    baselineCommitSha: row.baseline_commit_sha,
    dirtyStateFingerprint: row.dirty_state_fingerprint,
    context: JSON.parse(row.context_json) as RepositoryContextJson,
    isApprovable: row.is_approvable === 1,
    createdAt: row.created_at
  };
}

export function mapImplementationBrief(row: ImplementationBriefRow): ImplementationBrief {
  return {
    id: row.id,
    projectId: row.project_id,
    implementationTargetId: row.implementation_target_id,
    ticketRevisionId: row.ticket_revision_id,
    productBriefVersionId: row.product_brief_version_id,
    repositoryContextSnapshotId: row.repository_context_snapshot_id,
    supersedesImplementationBriefId:
      row.supersedes_implementation_brief_id,
    slug: row.slug,
    brief: JSON.parse(row.brief_json) as ImplementationBriefJson,
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    approvedByActorId: row.approved_by_actor_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapObservedEvidence(row: ObservedEvidenceRow): ObservedEvidence {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    evidenceType: row.evidence_type,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at
  };
}

export function mapImplementationResult(
  row: ImplementationResultRow
): ImplementationResult {
  return {
    id: row.id,
    projectId: row.project_id,
    implementationBriefId: row.implementation_brief_id,
    implementationTargetId: row.implementation_target_id,
    ticketRevisionId: row.ticket_revision_id,
    supersedesImplementationResultId:
      row.supersedes_implementation_result_id,
    result: JSON.parse(row.result_json) as ImplementationResultJson,
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    staleAtSubmission: row.stale_at_submission === 1,
    staleReasons: JSON.parse(row.stale_reasons_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export function mapAcceptanceCriterionVerdict(
  row: AcceptanceCriterionVerdictRow
): AcceptanceCriterionVerdict {
  return {
    id: row.id,
    implementationResultId: row.implementation_result_id,
    acceptanceCriterionId: row.acceptance_criterion_id,
    verdict: row.verdict,
    reason: row.reason,
    evidenceIds: JSON.parse(row.evidence_ids_json) as string[],
    createdAt: row.created_at
  };
}

export function mapAuditLogEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeSummary: parseOptionalJson(row.before_summary_json),
    afterSummary: parseOptionalJson(row.after_summary_json),
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at
  };
}

export function stringifyOptional(value: Record<string, unknown>|null): string|null {
  return value === null? null:JSON.stringify(value);
}

export function parseOptionalJson(value: string|null): Record<string, unknown>|null {
  return value === null
    ? null
    :(JSON.parse(value) as Record<string, unknown>);
}
