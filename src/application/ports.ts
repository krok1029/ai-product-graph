import type {
  AuditLogEntry,
  GraphDraftBatch,
  GraphDraftBatchChange,
  GraphEdge,
  GraphNode,
  GraphRevision,
  Idea,
  LifecycleStatus,
  LocalActor,
  Project,
  ProductBrief,
  ProductBriefVersion,
  ProjectCounts
} from "../domain/models.js";

export interface LocalActorRepository {
  ensure(actor: LocalActor): void;
}

export interface ProjectRepository {
  insert(project: Project): void;
  findById(id: string): Project | null;
  findBySlug(slug: string): Project | null;
  list(): Project[];
  getCounts(projectId: string): ProjectCounts;
  setCurrentProductBrief(
    projectId: string,
    productBriefId: string,
    updatedAt: string
  ): void;
  advanceGraphRevision(
    projectId: string,
    expectedGraphRevisionId: string | null,
    graphRevisionId: string,
    sourceProductBriefVersionId: string,
    updatedAt: string
  ): boolean;
}

export interface IdeaRepository {
  insert(idea: Idea): void;
  findById(id: string): Idea | null;
}

export interface ProductBriefRepository {
  insert(brief: ProductBrief): void;
  findByProjectId(projectId: string): ProductBrief | null;
  updateCurrentApprovedVersion(
    productBriefId: string,
    expectedVersionId: string | null,
    versionId: string,
    updatedAt: string
  ): boolean;
}

export interface ProductBriefVersionRepository {
  insert(version: ProductBriefVersion): void;
  findById(id: string): ProductBriefVersion | null;
  nextVersionNumber(productBriefId: string): number;
  approve(
    versionId: string,
    actorId: string,
    approvedAt: string
  ): void;
  archiveStaleDrafts(
    productBriefId: string,
    exceptVersionId: string,
    currentApprovedVersionId: string,
    archivedAt: string
  ): string[];
}

export interface GraphDraftBatchRepository {
  insert(batch: GraphDraftBatch, changes: GraphDraftBatchChange[]): void;
  findById(id: string): GraphDraftBatch | null;
  listChanges(batchId: string): GraphDraftBatchChange[];
  approve(batchId: string, actorId: string, approvedAt: string): void;
  archiveStaleDrafts(
    projectId: string,
    exceptBatchId: string,
    currentGraphRevisionId: string,
    archivedAt: string
  ): string[];
}

export interface GraphRevisionRepository {
  insert(revision: GraphRevision): void;
  nextSequenceNumber(projectId: string): number;
}

export interface GraphNodeRepository {
  insert(node: GraphNode): void;
  findById(id: string): GraphNode | null;
  findBySlug(projectId: string, slug: string): GraphNode | null;
  list(projectId: string, lifecycleStatus?: LifecycleStatus): GraphNode[];
  update(
    nodeId: string,
    input: {
      title?: string;
      description?: string | null;
      metadata?: Record<string, unknown>;
      sourceRefId: string;
      graphRevisionId: string;
      updatedAt: string;
    }
  ): void;
  archive(nodeId: string, graphRevisionId: string, archivedAt: string): void;
}

export interface GraphEdgeRepository {
  insert(edge: GraphEdge): void;
  findById(id: string): GraphEdge | null;
  list(projectId: string, lifecycleStatus?: LifecycleStatus): GraphEdge[];
  update(
    edgeId: string,
    input: {
      relationType?: GraphEdge["relationType"];
      confidence?: number | null;
      metadata?: Record<string, unknown>;
      graphRevisionId: string;
      updatedAt: string;
    }
  ): void;
  archive(edgeId: string, graphRevisionId: string, archivedAt: string): void;
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry): void;
  list(): AuditLogEntry[];
}

export interface TransactionRunner {
  run<T>(work: () => T): T;
}

export type ApplicationPorts = {
  localActors: LocalActorRepository;
  projects: ProjectRepository;
  ideas: IdeaRepository;
  productBriefs: ProductBriefRepository;
  productBriefVersions: ProductBriefVersionRepository;
  graphDraftBatches: GraphDraftBatchRepository;
  graphRevisions: GraphRevisionRepository;
  graphNodes: GraphNodeRepository;
  graphEdges: GraphEdgeRepository;
  auditLog: AuditLogRepository;
  transactions: TransactionRunner;
};
