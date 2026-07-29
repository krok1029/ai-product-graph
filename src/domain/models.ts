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
