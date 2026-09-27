import { ApplicationError } from "../domain/errors.js";
import type { AuditLogEntry, Repository } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

export type CreateRepositoryInput = {
  projectId: string;
  slug: string;
  name: string;
  rootPath?: string | null;
  remoteUrl?: string | null;
};

type RepositoryWorkflowOptions = {
  idFactory: () => string;
  clock: () => Date;
};

export class RepositoryWorkflow {
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly options: RepositoryWorkflowOptions
  ) {}

  create(input: CreateRepositoryInput) {
    const projectId = requiredText(input.projectId, "project_id");
    const slug = requiredText(input.slug, "slug");
    const name = requiredText(input.name, "name");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Repository slug must contain at most 80 lowercase letters, digits or separating hyphens."
      );
    }
    const rootPath = optionalText(input.rootPath, "root_path");
    const remoteUrl = optionalText(input.remoteUrl, "remote_url");

    return this.ports.transactions.run(() => {
      this.requireActiveProject(projectId);
      if (this.ports.repositories.findBySlug(projectId, slug)) {
        throw new ApplicationError("CONFLICT", "Repository slug already exists in this Project.", {
          projectId,
          slug
        });
      }
      const now = this.options.clock().toISOString();
      const repository: Repository = {
        id: this.options.idFactory(),
        projectId,
        slug,
        name,
        rootPath,
        remoteUrl,
        lifecycleStatus: "active",
        createdAt: now,
        updatedAt: now
      };
      const audit: AuditLogEntry = {
        id: this.options.idFactory(),
        projectId,
        actorType: "mcp_client",
        actorId: null,
        action: "repository.created",
        entityType: "repository",
        entityId: repository.id,
        beforeSummary: null,
        afterSummary: repository,
        metadata: {},
        createdAt: now
      };
      this.ports.repositories.insert(repository);
      this.ports.auditLog.append(audit);
      return { repository, auditLogId: audit.id };
    });
  }

  list(projectId: string) {
    const normalizedProjectId = requiredText(projectId, "project_id");
    this.requireActiveProject(normalizedProjectId);
    return { repositories: this.ports.repositories.list(normalizedProjectId) };
  }

  private requireActiveProject(projectId: string) {
    const project = this.ports.projects.findById(projectId);
    if (!project) {
      throw new ApplicationError("NOT_FOUND", "Project was not found.", { projectId });
    }
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Project is archived.", { projectId });
    }
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApplicationError("VALIDATION_ERROR", `Repository ${field} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApplicationError("VALIDATION_ERROR", `Repository ${field} must be a string or null.`);
  }
  return value.trim() || null;
}
