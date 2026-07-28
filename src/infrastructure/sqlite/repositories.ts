import type {
  AuditLogEntry,
  Idea,
  Project,
  ProjectCounts
} from "../../domain/models.js";
import type { ApplicationPorts } from "../../application/ports.js";
import type { SqliteDatabase } from "./database.js";

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type IdeaRow = {
  id: string;
  project_id: string;
  slug: string;
  content: string;
  source: string;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: string;
  project_id: string | null;
  actor_type: "mcp_client" | "system";
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_summary_json: string | null;
  after_summary_json: string | null;
  metadata_json: string;
  created_at: string;
};

export function createSqlitePorts(database: SqliteDatabase): ApplicationPorts {
  return {
    projects: {
      insert(project) {
        database
          .prepare(
            `INSERT INTO projects (
              id, slug, name, description, lifecycle_status,
              metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            project.id,
            project.slug,
            project.name,
            project.description,
            project.lifecycleStatus,
            project.createdAt,
            project.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, slug, name, description, lifecycle_status, created_at, updated_at
             FROM projects WHERE id = ?`
          )
          .get(id) as ProjectRow | undefined;
        return row ? mapProject(row) : null;
      },
      findBySlug(slug) {
        const row = database
          .prepare(
            `SELECT id, slug, name, description, lifecycle_status, created_at, updated_at
             FROM projects WHERE slug = ?`
          )
          .get(slug) as ProjectRow | undefined;
        return row ? mapProject(row) : null;
      },
      list() {
        const rows = database
          .prepare(
            `SELECT id, slug, name, description, lifecycle_status, created_at, updated_at
             FROM projects ORDER BY created_at, id`
          )
          .all() as ProjectRow[];
        return rows.map(mapProject);
      },
      getCounts(projectId) {
        const row = database
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM ideas WHERE project_id = ?) AS ideas,
              (SELECT COUNT(*) FROM graph_nodes WHERE project_id = ?) AS graph_nodes,
              (SELECT COUNT(*) FROM tickets WHERE project_id = ?) AS tickets`
          )
          .get(projectId, projectId, projectId) as {
          ideas: number;
          graph_nodes: number;
          tickets: number;
        };
        return {
          ideas: row.ideas,
          graphNodes: row.graph_nodes,
          tickets: row.tickets
        } satisfies ProjectCounts;
      }
    },
    ideas: {
      insert(idea) {
        database
          .prepare(
            `INSERT INTO ideas (
              id, project_id, slug, content, source, lifecycle_status,
              metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            idea.id,
            idea.projectId,
            idea.slug,
            idea.content,
            idea.source,
            idea.lifecycleStatus,
            idea.createdAt,
            idea.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, slug, content, source, lifecycle_status,
                    created_at, updated_at
             FROM ideas WHERE id = ?`
          )
          .get(id) as IdeaRow | undefined;
        return row ? mapIdea(row) : null;
      }
    },
    auditLog: {
      append(entry) {
        database
          .prepare(
            `INSERT INTO audit_log (
              id, project_id, actor_type, actor_id, action, entity_type,
              entity_id, before_summary_json, after_summary_json,
              metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            entry.id,
            entry.projectId,
            entry.actorType,
            entry.actorId,
            entry.action,
            entry.entityType,
            entry.entityId,
            stringifyOptional(entry.beforeSummary),
            stringifyOptional(entry.afterSummary),
            JSON.stringify(entry.metadata),
            entry.createdAt
          );
      },
      list() {
        const rows = database
          .prepare(
            `SELECT id, project_id, actor_type, actor_id, action, entity_type,
                    entity_id, before_summary_json, after_summary_json,
                    metadata_json, created_at
             FROM audit_log ORDER BY created_at, id`
          )
          .all() as AuditRow[];
        return rows.map(mapAuditLogEntry);
      }
    },
    transactions: {
      run<T>(work: () => T): T {
        return database.transaction(work)();
      }
    }
  };
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapIdea(row: IdeaRow): Idea {
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

function mapAuditLogEntry(row: AuditRow): AuditLogEntry {
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

function stringifyOptional(value: Record<string, unknown> | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function parseOptionalJson(value: string | null): Record<string, unknown> | null {
  return value === null
    ? null
    : (JSON.parse(value) as Record<string, unknown>);
}
