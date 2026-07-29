import type {
  AuditLogEntry,
  Idea,
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
  auditLog: AuditLogRepository;
  transactions: TransactionRunner;
};
