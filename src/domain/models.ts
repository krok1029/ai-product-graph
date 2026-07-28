export type LifecycleStatus = "active" | "archived";

export type Project = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lifecycleStatus: LifecycleStatus;
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
