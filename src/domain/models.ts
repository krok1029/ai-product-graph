export type LifecycleStatus = "active" | "archived";
export type ReviewStatus = "draft" | "approved";

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
  createdInGraphRevisionId: string;
  lastChangedInGraphRevisionId: string;
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
  createdInGraphRevisionId: string;
  lastChangedInGraphRevisionId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
