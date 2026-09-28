export type LifecycleStatus = "active" | "archived";
export type ReviewStatus = "draft" | "approved";
export type DeliveryStatus = "planned" | "in_progress" | "blocked" | "done";

export type LocalActor = {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lifecycleStatus: LifecycleStatus;
  currentProductBriefId: string | null;
  currentGraphRevisionId: string | null;
  lastReconciledProductBriefVersionId: string | null;
  productIntentGraphRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Idea = {
  id: string;
  projectId: string;
  slug: string;
  content: string;
  source: string;
  lifecycleStatus: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type ProductBriefJson = {
  product_goal: string;
  target_users: Array<{
    name: string;
    description: string;
  }>;
  pain_points: Array<{
    title: string;
    description: string;
  }>;
  core_workflows: Array<{
    title: string;
    steps: string[];
  }>;
  mvp_scope: string[];
  non_goals: string[];
  success_metrics: string[];
  risks: string[];
  open_questions: string[];
};

export type ProductBrief = {
  id: string;
  projectId: string;
  sourceIdeaId: string | null;
  slug: string;
  currentApprovedVersionId: string | null;
  lifecycleStatus: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type ProductBriefVersion = {
  id: string;
  productBriefId: string;
  projectId: string;
  versionNumber: number;
  baseApprovedVersionId: string | null;
  brief: ProductBriefJson;
  reviewStatus: ReviewStatus;
  lifecycleStatus: LifecycleStatus;
  approvedByActorId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GraphNodeType =
  | "idea"
  | "product_brief"
  | "milestone"
  | "spec"
  | "product_goal"
  | "persona"
  | "pain_point"
  | "workflow"
  | "feature_area"
  | "epic"
  | "ticket"
  | "acceptance_criterion"
  | "decision"
  | "repository"
  | "code_file"
  | "pull_request"
  | "test_case"
  | "release"
  | "feedback"
  | "implementation_target"
  | "external_work_item";

export type GraphRelationType =
  | "clarifies"
  | "supports"
  | "solves"
  | "belongs_to"
  | "depends_on"
  | "implements"
  | "validated_by"
  | "changed_by"
  | "traces_to"
  | "blocked_by"
  | "supersedes"
  | "waives";

export type GraphDraftBatch = {
  id: string;
  projectId: string;
  sourceProductBriefVersionId: string;
  baseGraphRevisionId: string | null;
  reconciliationSummary: string | null;
  reviewStatus: ReviewStatus;
  lifecycleStatus: LifecycleStatus;
  approvedByActorId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GraphDraftBatchChange = {
  id: string;
  graphDraftBatchId: string;
  projectId: string;
  changeId: string;
  operation: "add" | "update" | "archive";
  entityKind: "node" | "edge";
  targetId: string | null;
  payload: Record<string, unknown>;
  conflict: Record<string, unknown> | null;
  createdAt: string;
};

export type GraphRevision = {
  id: string;
  projectId: string;
  graphDraftBatchId: string;
  sourceProductBriefVersionId: string;
  sequenceNumber: number;
  isNoopReconciliation: boolean;
  reconciliationSummary: string | null;
  createdAt: string;
};

export type GraphNode = {
  id: string;
  projectId: string;
  slug: string;
  type: GraphNodeType;
  title: string;
  description: string | null;
  source: string;
  sourceRefType: string | null;
  sourceRefId: string | null;
  lifecycleStatus: LifecycleStatus;
  createdInGraphRevisionId: string | null;
  lastChangedInGraphRevisionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GraphEdge = {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: GraphRelationType;
  confidence: number | null;
  lifecycleStatus: LifecycleStatus;
  createdInGraphRevisionId: string | null;
  lastChangedInGraphRevisionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Repository = {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  rootPath: string | null;
  remoteUrl: string | null;
  lifecycleStatus: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type TicketDraftBatch = {
  id: string;
  projectId: string;
  sourceGraphRevisionId: string;
  lifecycleStatus: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type AcceptanceCriterion = {
  id: string;
  text: string;
};

export type TicketSpecification = {
  source_spec_id?: string;
  traces_to_ticket_id: string | null;
  user_story: string;
  scope: string[];
  acceptance_criteria: AcceptanceCriterion[];
  non_goals: string[];
  related_graph_node_ids: string[];
  dependencies: string[];
  implementation_notes: string[];
};

export type RequiredImplementationTarget = {
  repository_id: string;
  scope: string[];
};

export type Ticket = {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  currentApprovedRevisionId: string | null;
  lifecycleStatus: LifecycleStatus;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
  updatedAt: string;
};

export type TicketRevision = {
  id: string;
  ticketId: string;
  projectId: string;
  ticketDraftBatchId: string | null;
  revisionNumber: number;
  baseApprovedRevisionId: string | null;
  sourceGraphRevisionId: string;
  title: string;
  specification: TicketSpecification;
  requiredTargets: RequiredImplementationTarget[];
  reviewStatus: ReviewStatus;
  lifecycleStatus: LifecycleStatus;
  approvedByActorId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImplementationTarget = {
  id: string;
  projectId: string;
  ticketId: string;
  repositoryId: string;
  lifecycleStatus: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type RepositoryContextJson = {
  repository_name: string;
  summary: string;
  file_list: string[];
  module_notes: string[];
  has_uncommitted_changes: boolean;
};

export type RepositoryContextSnapshot = {
  id: string;
  projectId: string;
  repositoryId: string;
  baselineCommitSha: string | null;
  dirtyStateFingerprint: string | null;
  context: RepositoryContextJson;
  isApprovable: boolean;
  createdAt: string;
};

export type ImplementationBriefJson = {
  implementation_plan: string[];
  suggested_files_to_inspect: string[];
  test_strategy: string[];
  risks: string[];
  pr_summary_draft: string;
};

export type ImplementationBrief = {
  id: string;
  projectId: string;
  implementationTargetId: string;
  ticketRevisionId: string;
  productBriefVersionId: string;
  repositoryContextSnapshotId: string;
  supersedesImplementationBriefId: string | null;
  slug: string;
  brief: ImplementationBriefJson;
  reviewStatus: ReviewStatus;
  lifecycleStatus: LifecycleStatus;
  approvedByActorId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ObservedEvidenceType =
  | "commit"
  | "pull_request"
  | "test_execution"
  | "artifact";

export type ObservedEvidence = {
  id: string;
  projectId: string;
  repositoryId: string;
  evidenceType: ObservedEvidenceType;
  idempotencyKey: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  lifecycleStatus: LifecycleStatus;
  createdAt: string;
};

export type ImplementationResultJson = {
  summary: string;
  unfinished_items: string[];
  submission_disposition: "reviewable" | "stale_archived";
};

export type ImplementationResult = {
  id: string;
  projectId: string;
  implementationBriefId: string;
  implementationTargetId: string;
  ticketRevisionId: string;
  supersedesImplementationResultId: string | null;
  result: ImplementationResultJson;
  reviewStatus: ReviewStatus;
  lifecycleStatus: LifecycleStatus;
  staleAtSubmission: boolean;
  staleReasons: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type AcceptanceCriterionVerdict = {
  id: string;
  implementationResultId: string;
  acceptanceCriterionId: string;
  verdict: "satisfied" | "unsatisfied";
  reason: string;
  evidenceIds: string[];
  createdAt: string;
};

export type AuditLogEntry = {
  id: string;
  projectId: string | null;
  actorType: "mcp_client" | "system";
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeSummary: Record<string, unknown> | null;
  afterSummary: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ProjectCounts = {
  ideas: number;
  graphNodes: number;
  tickets: number;
};
