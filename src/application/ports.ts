import type {
  AuditLogEntry,
  Idea,
  Project,
  ProjectCounts
} from "../domain/models.js";

export interface ProjectRepository {
  insert(project: Project): void;
  findById(id: string): Project | null;
  findBySlug(slug: string): Project | null;
  list(): Project[];
  getCounts(projectId: string): ProjectCounts;
}

export interface IdeaRepository {
  insert(idea: Idea): void;
  findById(id: string): Idea | null;
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry): void;
  list(): AuditLogEntry[];
}

export interface TransactionRunner {
  run<T>(work: () => T): T;
}

export type ApplicationPorts = {
  projects: ProjectRepository;
  ideas: IdeaRepository;
  auditLog: AuditLogRepository;
  transactions: TransactionRunner;
};
