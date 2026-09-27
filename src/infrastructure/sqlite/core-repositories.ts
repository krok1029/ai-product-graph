// 核心資料 persistence adapter。
//
// Project、Idea、Product Brief 與 Repository records 的 SQLite adapter。
// 這些 repository 是 graph、ticket 與 implementation workflows 共用的基礎狀態。

import type { ProjectCounts } from "../../domain/models.js";
import type { ApplicationPorts } from "../../application/ports.js";
import type { SqliteDatabase } from "./database.js";
import {
  mapIdea,
  mapProductBrief,
  mapProductBriefVersion,
  mapProject,
  mapRepository,
  type IdeaRow,
  type ProductBriefRow,
  type ProductBriefVersionRow,
  type ProjectRow,
  type RepositoryRow
} from "./row-mappers.js";

export function createCoreRepositories(
  database: SqliteDatabase
): Pick<
  ApplicationPorts,
  | "localActors"
  | "projects"
  | "ideas"
  | "productBriefs"
  | "productBriefVersions"
  | "repositories"
> {
  return {
    localActors: {
      ensure(actor) {
        database
          .prepare(
            `INSERT INTO local_actors (
          id, display_name, metadata_json, created_at, updated_at
        ) VALUES (?, ?, '{}', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = excluded.updated_at`
          )
          .run(
            actor.id,
            actor.displayName,
            actor.createdAt,
            actor.updatedAt
          );
      }
    },
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
            `SELECT id, slug, name, description, lifecycle_status,
                current_product_brief_id, current_graph_revision_id,
                last_reconciled_product_brief_version_id,
                product_intent_graph_revision_id, created_at, updated_at
         FROM projects WHERE id = ?`
          )
          .get(id) as ProjectRow|undefined;
        return row? mapProject(row):null;
      },
      findBySlug(slug) {
        const row = database
          .prepare(
            `SELECT id, slug, name, description, lifecycle_status,
                current_product_brief_id, current_graph_revision_id,
                last_reconciled_product_brief_version_id,
                product_intent_graph_revision_id, created_at, updated_at
         FROM projects WHERE slug = ?`
          )
          .get(slug) as ProjectRow|undefined;
        return row? mapProject(row):null;
      },
      list() {
        const rows = database
          .prepare(
            `SELECT id, slug, name, description, lifecycle_status,
                current_product_brief_id, current_graph_revision_id,
                last_reconciled_product_brief_version_id,
                product_intent_graph_revision_id, created_at, updated_at
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
      },
      setCurrentProductBrief(projectId, productBriefId, updatedAt) {
        database
          .prepare(
            `UPDATE projects
         SET current_product_brief_id = ?, updated_at = ?
         WHERE id = ?`
          )
          .run(productBriefId, updatedAt, projectId);
      },
      advanceGraphRevision(
        projectId,
        expectedGraphRevisionId,
        graphRevisionId,
        sourceProductBriefVersionId,
        updatedAt
      ) {
        const result = database
          .prepare(
            `UPDATE projects
         SET current_graph_revision_id = ?,
             last_reconciled_product_brief_version_id = ?,
             product_intent_graph_revision_id = ?,
             updated_at = ?
         WHERE id = ?
           AND lifecycle_status = 'active'
           AND current_graph_revision_id IS ?`
          )
          .run(
            graphRevisionId,
            sourceProductBriefVersionId,
            graphRevisionId,
            updatedAt,
            projectId,
            expectedGraphRevisionId
          );
        return result.changes === 1;
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
          .get(id) as IdeaRow|undefined;
        return row? mapIdea(row):null;
      }
    },
    productBriefs: {
      insert(brief) {
        database
          .prepare(
            `INSERT INTO product_briefs (
          id, project_id, source_idea_id, slug,
          current_approved_version_id, lifecycle_status,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            brief.id,
            brief.projectId,
            brief.sourceIdeaId,
            brief.slug,
            brief.currentApprovedVersionId,
            brief.lifecycleStatus,
            brief.createdAt,
            brief.updatedAt
          );
      },
      findByProjectId(projectId) {
        const row = database
          .prepare(
            `SELECT id, project_id, source_idea_id, slug,
                current_approved_version_id, lifecycle_status,
                created_at, updated_at
         FROM product_briefs
         WHERE project_id = ? AND lifecycle_status = 'active'`
          )
          .get(projectId) as ProductBriefRow|undefined;
        return row? mapProductBrief(row):null;
      },
      updateCurrentApprovedVersion(
        productBriefId,
        expectedVersionId,
        versionId,
        updatedAt
      ) {
        const result = database
          .prepare(
            `UPDATE product_briefs
         SET current_approved_version_id = ?, updated_at = ?
         WHERE id = ?
           AND lifecycle_status = 'active'
           AND current_approved_version_id IS ?`
          )
          .run(versionId, updatedAt, productBriefId, expectedVersionId);
        return result.changes === 1;
      }
    },
    productBriefVersions: {
      insert(version) {
        database
          .prepare(
            `INSERT INTO product_brief_versions (
          id, product_brief_id, project_id, version_number,
          base_approved_version_id, brief_json, review_status,
          lifecycle_status, approved_by_actor_id, approved_at,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            version.id,
            version.productBriefId,
            version.projectId,
            version.versionNumber,
            version.baseApprovedVersionId,
            JSON.stringify(version.brief),
            version.reviewStatus,
            version.lifecycleStatus,
            version.approvedByActorId,
            version.approvedAt,
            version.createdAt,
            version.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, product_brief_id, project_id, version_number,
                base_approved_version_id, brief_json, review_status,
                lifecycle_status, approved_by_actor_id, approved_at,
                created_at, updated_at
         FROM product_brief_versions WHERE id = ?`
          )
          .get(id) as ProductBriefVersionRow|undefined;
        return row? mapProductBriefVersion(row):null;
      },
      nextVersionNumber(productBriefId) {
        const row = database
          .prepare(
            `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
         FROM product_brief_versions WHERE product_brief_id = ?`
          )
          .get(productBriefId) as { version_number: number };
        return row.version_number;
      },
      approve(versionId, actorId, approvedAt) {
        database
          .prepare(
            `UPDATE product_brief_versions
         SET review_status = 'approved', approved_by_actor_id = ?,
             approved_at = ?, updated_at = ?
         WHERE id = ?`
          )
          .run(actorId, approvedAt, approvedAt, versionId);
      },
      archiveStaleDrafts(
        productBriefId,
        exceptVersionId,
        currentApprovedVersionId,
        archivedAt
      ) {
        const rows = database
          .prepare(
            `SELECT id
         FROM product_brief_versions
         WHERE product_brief_id = ?
           AND id <> ?
           AND review_status = 'draft'
           AND lifecycle_status = 'active'
           AND base_approved_version_id IS NOT ?
         ORDER BY version_number, id`
          )
          .all(
            productBriefId,
            exceptVersionId,
            currentApprovedVersionId
          ) as Array<{ id: string }>;
        if (rows.length>0) {
          const placeholders = rows.map(() => "?").join(", ");
          database
            .prepare(
              `UPDATE product_brief_versions
           SET lifecycle_status = 'archived', archived_at = ?, updated_at = ?
           WHERE id IN (${placeholders})`
            )
            .run(archivedAt, archivedAt,...rows.map(row => row.id));
        }
        return rows.map(row => row.id);
      }
    },
    repositories: {
      insert(repository) {
        database
          .prepare(
            `INSERT INTO repositories (
          id, project_id, slug, name, root_path, remote_url,
          lifecycle_status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            repository.id,
            repository.projectId,
            repository.slug,
            repository.name,
            repository.rootPath,
            repository.remoteUrl,
            repository.lifecycleStatus,
            repository.createdAt,
            repository.updatedAt
          );
      },
      findBySlug(projectId, slug) {
        const row = database
          .prepare(`SELECT id, project_id, slug, name, root_path, remote_url,
            lifecycle_status, created_at, updated_at
            FROM repositories WHERE project_id = ? AND slug = ?`)
          .get(projectId, slug) as RepositoryRow | undefined;
        return row ? mapRepository(row) : null;
      },
      list(projectId) {
        const rows = database
          .prepare(`SELECT id, project_id, slug, name, root_path, remote_url,
            lifecycle_status, created_at, updated_at
            FROM repositories WHERE project_id = ? ORDER BY created_at, id`)
          .all(projectId) as RepositoryRow[];
        return rows.map(mapRepository);
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, slug, name, root_path, remote_url,
                lifecycle_status, created_at, updated_at
         FROM repositories WHERE id = ?`
          )
          .get(id) as RepositoryRow|undefined;
        return row? mapRepository(row):null;
      }
    },
  };
}
