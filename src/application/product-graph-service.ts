import { ulid } from "ulid";

import { ApplicationError } from "../domain/errors.js";
import type {
  AuditLogEntry,
  Idea,
  Project
} from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

type ServiceOptions = {
  idFactory?: () => string;
  clock?: () => Date;
};

export class ProductGraphService {
  private readonly idFactory: () => string;
  private readonly clock: () => Date;

  constructor(
    private readonly ports: ApplicationPorts,
    options: ServiceOptions = {}
  ) {
    this.idFactory = options.idFactory ?? ulid;
    this.clock = options.clock ?? (() => new Date());
  }

  createProject(input: { name: string; description?: string }) {
    const name = input.name.trim();
    if (!name) {
      throw new ApplicationError("VALIDATION_ERROR", "Project name is required.");
    }

    const id = this.idFactory();
    const now = this.clock().toISOString();
    const baseSlug = slugify(name) || `project-${id.slice(-8).toLowerCase()}`;
    const slug = this.uniqueProjectSlug(baseSlug, id);
    const project: Project = {
      id,
      slug,
      name,
      description: normalizeOptionalText(input.description),
      lifecycleStatus: "active",
      createdAt: now,
      updatedAt: now
    };
    const audit = this.newAuditEntry({
      projectId: id,
      action: "project.created",
      entityType: "project",
      entityId: id,
      afterSummary: project,
      createdAt: now
    });

    this.ports.transactions.run(() => {
      this.ports.projects.insert(project);
      this.ports.auditLog.append(audit);
    });

    return { project, auditLogId: audit.id };
  }

  listProjects() {
    return { projects: this.ports.projects.list() };
  }

  getProject(projectId: string) {
    const project = this.requireProject(projectId);
    return {
      project,
      counts: this.ports.projects.getCounts(project.id)
    };
  }

  addIdea(input: { projectId: string; content: string; source: string }) {
    const project = this.requireProject(input.projectId);
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Project is archived.", {
        projectId: project.id
      });
    }

    const content = input.content.trim();
    const source = input.source.trim();
    if (!content || !source) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Idea content and source are required."
      );
    }

    const id = this.idFactory();
    const now = this.clock().toISOString();
    const idea: Idea = {
      id,
      projectId: project.id,
      slug: `idea-${id.slice(-8).toLowerCase()}`,
      content,
      source,
      lifecycleStatus: "active",
      createdAt: now,
      updatedAt: now
    };
    const audit = this.newAuditEntry({
      projectId: project.id,
      action: "idea.added",
      entityType: "idea",
      entityId: id,
      afterSummary: idea,
      createdAt: now
    });

    this.ports.transactions.run(() => {
      this.ports.ideas.insert(idea);
      this.ports.auditLog.append(audit);
    });

    return { idea, auditLogId: audit.id };
  }

  getIdea(ideaId: string) {
    const idea = this.ports.ideas.findById(ideaId);
    if (!idea) {
      throw new ApplicationError("NOT_FOUND", "Idea was not found.", {
        ideaId
      });
    }
    return { idea };
  }

  private requireProject(projectId: string): Project {
    const project = this.ports.projects.findById(projectId);
    if (!project) {
      throw new ApplicationError("NOT_FOUND", "Project was not found.", {
        projectId
      });
    }
    return project;
  }

  private uniqueProjectSlug(baseSlug: string, id: string): string {
    if (!this.ports.projects.findBySlug(baseSlug)) {
      return baseSlug;
    }
    return `${baseSlug}-${id.slice(-6).toLowerCase()}`;
  }

  private newAuditEntry(input: {
    projectId: string;
    action: string;
    entityType: string;
    entityId: string;
    afterSummary: Record<string, unknown>;
    createdAt: string;
  }): AuditLogEntry {
    return {
      id: this.idFactory(),
      projectId: input.projectId,
      actorType: "mcp_client",
      actorId: null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeSummary: null,
      afterSummary: input.afterSummary,
      metadata: {},
      createdAt: input.createdAt
    };
  }
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
