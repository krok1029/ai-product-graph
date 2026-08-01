import type {
  AuditLogEntry,
  GraphDraftBatch,
  GraphDraftBatchChange,
  GraphEdge,
  GraphNode,
  GraphRevision,
  Idea,
  Project,
  ProductBrief,
  ProductBriefJson,
  ProductBriefVersion,
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
  current_product_brief_id: string | null;
  current_graph_revision_id: string | null;
  last_reconciled_product_brief_version_id: string | null;
  product_intent_graph_revision_id: string | null;
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

type ProductBriefRow = {
  id: string;
  project_id: string;
  source_idea_id: string | null;
  slug: string;
  current_approved_version_id: string | null;
  lifecycle_status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type ProductBriefVersionRow = {
  id: string;
  product_brief_id: string;
  project_id: string;
  version_number: number;
  base_approved_version_id: string | null;
  brief_json: string;
  review_status: "draft" | "approved";
  lifecycle_status: "active" | "archived";
  approved_by_actor_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type GraphDraftBatchRow = {
  id: string;
  project_id: string;
  source_product_brief_version_id: string;
  base_graph_revision_id: string | null;
  reconciliation_summary: string | null;
  review_status: "draft" | "approved";
  lifecycle_status: "active" | "archived";
  approved_by_actor_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type GraphDraftBatchChangeRow = {
  id: string;
  graph_draft_batch_id: string;
  project_id: string;
  change_id: string;
  operation: "add" | "update" | "archive";
  entity_kind: "node" | "edge";
  target_id: string | null;
  payload_json: string;
  conflict_json: string | null;
  created_at: string;
};

type GraphNodeRow = {
  id: string;
  project_id: string;
  slug: string;
  type: GraphNode["type"];
  title: string;
  description: string | null;
  source: string;
  source_ref_type: string | null;
  source_ref_id: string | null;
  lifecycle_status: "active" | "archived";
  created_in_graph_revision_id: string;
  last_changed_in_graph_revision_id: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type GraphEdgeRow = {
  id: string;
  project_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: GraphEdge["relationType"];
  confidence: number | null;
  lifecycle_status: "active" | "archived";
  created_in_graph_revision_id: string;
  last_changed_in_graph_revision_id: string;
  metadata_json: string;
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
          .get(id) as ProjectRow | undefined;
        return row ? mapProject(row) : null;
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
          .get(slug) as ProjectRow | undefined;
        return row ? mapProject(row) : null;
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
          .get(id) as IdeaRow | undefined;
        return row ? mapIdea(row) : null;
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
          .get(projectId) as ProductBriefRow | undefined;
        return row ? mapProductBrief(row) : null;
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
          .get(id) as ProductBriefVersionRow | undefined;
        return row ? mapProductBriefVersion(row) : null;
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
        if (rows.length > 0) {
          const placeholders = rows.map(() => "?").join(", ");
          database
            .prepare(
              `UPDATE product_brief_versions
               SET lifecycle_status = 'archived', archived_at = ?, updated_at = ?
               WHERE id IN (${placeholders})`
            )
            .run(archivedAt, archivedAt, ...rows.map(row => row.id));
        }
        return rows.map(row => row.id);
      }
    },
    graphDraftBatches: {
      insert(batch, changes) {
        database
          .prepare(
            `INSERT INTO graph_draft_batches (
              id, project_id, source_product_brief_version_id,
              base_graph_revision_id, reconciliation_summary,
              review_status, lifecycle_status, approved_by_actor_id,
              approved_at, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            batch.id,
            batch.projectId,
            batch.sourceProductBriefVersionId,
            batch.baseGraphRevisionId,
            batch.reconciliationSummary,
            batch.reviewStatus,
            batch.lifecycleStatus,
            batch.approvedByActorId,
            batch.approvedAt,
            batch.createdAt,
            batch.updatedAt
          );
        const statement = database.prepare(
          `INSERT INTO graph_draft_batch_changes (
            id, graph_draft_batch_id, project_id, change_id,
            operation, entity_kind, target_id, payload_json,
            conflict_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const change of changes) {
          statement.run(
            change.id,
            change.graphDraftBatchId,
            change.projectId,
            change.changeId,
            change.operation,
            change.entityKind,
            change.targetId,
            JSON.stringify(change.payload),
            stringifyOptional(change.conflict),
            change.createdAt
          );
        }
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, source_product_brief_version_id,
                    base_graph_revision_id, reconciliation_summary,
                    review_status, lifecycle_status, approved_by_actor_id,
                    approved_at, created_at, updated_at
             FROM graph_draft_batches WHERE id = ?`
          )
          .get(id) as GraphDraftBatchRow | undefined;
        return row ? mapGraphDraftBatch(row) : null;
      },
      listChanges(batchId) {
        const rows = database
          .prepare(
            `SELECT id, graph_draft_batch_id, project_id, change_id,
                    operation, entity_kind, target_id, payload_json,
                    conflict_json, created_at
             FROM graph_draft_batch_changes
             WHERE graph_draft_batch_id = ?
             ORDER BY rowid`
          )
          .all(batchId) as GraphDraftBatchChangeRow[];
        return rows.map(mapGraphDraftBatchChange);
      },
      approve(batchId, actorId, approvedAt) {
        database
          .prepare(
            `UPDATE graph_draft_batches
             SET review_status = 'approved', approved_by_actor_id = ?,
                 approved_at = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(actorId, approvedAt, approvedAt, batchId);
      },
      archiveStaleDrafts(
        projectId,
        exceptBatchId,
        currentGraphRevisionId,
        archivedAt
      ) {
        const rows = database
          .prepare(
            `SELECT id
             FROM graph_draft_batches
             WHERE project_id = ?
               AND id <> ?
               AND review_status = 'draft'
               AND lifecycle_status = 'active'
               AND base_graph_revision_id IS NOT ?
             ORDER BY created_at, id`
          )
          .all(
            projectId,
            exceptBatchId,
            currentGraphRevisionId
          ) as Array<{ id: string }>;
        if (rows.length > 0) {
          const placeholders = rows.map(() => "?").join(", ");
          database
            .prepare(
              `UPDATE graph_draft_batches
               SET lifecycle_status = 'archived', archived_at = ?,
                   updated_at = ?
               WHERE id IN (${placeholders})`
            )
            .run(archivedAt, archivedAt, ...rows.map(row => row.id));
        }
        return rows.map(row => row.id);
      }
    },
    graphRevisions: {
      insert(revision) {
        database
          .prepare(
            `INSERT INTO graph_revisions (
              id, project_id, graph_draft_batch_id,
              source_product_brief_version_id, sequence_number,
              is_noop_reconciliation, reconciliation_summary, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            revision.id,
            revision.projectId,
            revision.graphDraftBatchId,
            revision.sourceProductBriefVersionId,
            revision.sequenceNumber,
            revision.isNoopReconciliation ? 1 : 0,
            revision.reconciliationSummary,
            revision.createdAt
          );
      },
      nextSequenceNumber(projectId) {
        const row = database
          .prepare(
            `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS sequence_number
             FROM graph_revisions WHERE project_id = ?`
          )
          .get(projectId) as { sequence_number: number };
        return row.sequence_number;
      }
    },
    graphNodes: {
      insert(node) {
        database
          .prepare(
            `INSERT INTO graph_nodes (
              id, project_id, slug, type, title, description, source,
              source_ref_type, source_ref_id, external_ref,
              lifecycle_status, created_in_graph_revision_id,
              last_changed_in_graph_revision_id, metadata_json,
              embedding_ref, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)`
          )
          .run(
            node.id,
            node.projectId,
            node.slug,
            node.type,
            node.title,
            node.description,
            node.source,
            node.sourceRefType,
            node.sourceRefId,
            node.lifecycleStatus,
            node.createdInGraphRevisionId,
            node.lastChangedInGraphRevisionId,
            JSON.stringify(node.metadata),
            node.createdAt,
            node.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, slug, type, title, description, source,
                    source_ref_type, source_ref_id, lifecycle_status,
                    created_in_graph_revision_id,
                    last_changed_in_graph_revision_id, metadata_json,
                    created_at, updated_at
             FROM graph_nodes WHERE id = ?`
          )
          .get(id) as GraphNodeRow | undefined;
        return row ? mapGraphNode(row) : null;
      },
      findBySlug(projectId, slug) {
        const row = database
          .prepare(
            `SELECT id, project_id, slug, type, title, description, source,
                    source_ref_type, source_ref_id, lifecycle_status,
                    created_in_graph_revision_id,
                    last_changed_in_graph_revision_id, metadata_json,
                    created_at, updated_at
             FROM graph_nodes WHERE project_id = ? AND slug = ?`
          )
          .get(projectId, slug) as GraphNodeRow | undefined;
        return row ? mapGraphNode(row) : null;
      },
      list(projectId, lifecycleStatus) {
        const sql = `SELECT id, project_id, slug, type, title, description,
                            source, source_ref_type, source_ref_id,
                            lifecycle_status, created_in_graph_revision_id,
                            last_changed_in_graph_revision_id, metadata_json,
                            created_at, updated_at
                     FROM graph_nodes
                     WHERE project_id = ?${
                       lifecycleStatus ? " AND lifecycle_status = ?" : ""
                     }
                     ORDER BY type, slug, id`;
        const rows = lifecycleStatus
          ? (database.prepare(sql).all(
              projectId,
              lifecycleStatus
            ) as GraphNodeRow[])
          : (database.prepare(sql).all(projectId) as GraphNodeRow[]);
        return rows.map(mapGraphNode);
      },
      update(nodeId, input) {
        const assignments = [
          "source_ref_type = 'product_brief_version'",
          "source_ref_id = ?",
          "last_changed_in_graph_revision_id = ?",
          "updated_at = ?"
        ];
        const values: unknown[] = [
          input.sourceRefId,
          input.graphRevisionId,
          input.updatedAt
        ];
        if (input.title !== undefined) {
          assignments.push("title = ?");
          values.push(input.title);
        }
        if (input.description !== undefined) {
          assignments.push("description = ?");
          values.push(input.description);
        }
        if (input.metadata !== undefined) {
          assignments.push("metadata_json = ?");
          values.push(JSON.stringify(input.metadata));
        }
        database
          .prepare(
            `UPDATE graph_nodes SET ${assignments.join(", ")} WHERE id = ?`
          )
          .run(...values, nodeId);
      },
      archive(nodeId, graphRevisionId, archivedAt) {
        database
          .prepare(
            `UPDATE graph_nodes
             SET lifecycle_status = 'archived', archived_at = ?,
                 last_changed_in_graph_revision_id = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(archivedAt, graphRevisionId, archivedAt, nodeId);
      }
    },
    graphEdges: {
      insert(edge) {
        database
          .prepare(
            `INSERT INTO graph_edges (
              id, project_id, source_node_id, target_node_id,
              relation_type, confidence, lifecycle_status,
              created_in_graph_revision_id,
              last_changed_in_graph_revision_id, metadata_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            edge.id,
            edge.projectId,
            edge.sourceNodeId,
            edge.targetNodeId,
            edge.relationType,
            edge.confidence,
            edge.lifecycleStatus,
            edge.createdInGraphRevisionId,
            edge.lastChangedInGraphRevisionId,
            JSON.stringify(edge.metadata),
            edge.createdAt,
            edge.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, source_node_id, target_node_id,
                    relation_type, confidence, lifecycle_status,
                    created_in_graph_revision_id,
                    last_changed_in_graph_revision_id, metadata_json,
                    created_at, updated_at
             FROM graph_edges WHERE id = ?`
          )
          .get(id) as GraphEdgeRow | undefined;
        return row ? mapGraphEdge(row) : null;
      },
      list(projectId, lifecycleStatus) {
        const sql = `SELECT id, project_id, source_node_id, target_node_id,
                            relation_type, confidence, lifecycle_status,
                            created_in_graph_revision_id,
                            last_changed_in_graph_revision_id, metadata_json,
                            created_at, updated_at
                     FROM graph_edges
                     WHERE project_id = ?${
                       lifecycleStatus ? " AND lifecycle_status = ?" : ""
                     }
                     ORDER BY relation_type, source_node_id, target_node_id, id`;
        const rows = lifecycleStatus
          ? (database.prepare(sql).all(
              projectId,
              lifecycleStatus
            ) as GraphEdgeRow[])
          : (database.prepare(sql).all(projectId) as GraphEdgeRow[]);
        return rows.map(mapGraphEdge);
      },
      update(edgeId, input) {
        const assignments = [
          "last_changed_in_graph_revision_id = ?",
          "updated_at = ?"
        ];
        const values: unknown[] = [input.graphRevisionId, input.updatedAt];
        if (input.relationType !== undefined) {
          assignments.push("relation_type = ?");
          values.push(input.relationType);
        }
        if (input.confidence !== undefined) {
          assignments.push("confidence = ?");
          values.push(input.confidence);
        }
        if (input.metadata !== undefined) {
          assignments.push("metadata_json = ?");
          values.push(JSON.stringify(input.metadata));
        }
        database
          .prepare(
            `UPDATE graph_edges SET ${assignments.join(", ")} WHERE id = ?`
          )
          .run(...values, edgeId);
      },
      archive(edgeId, graphRevisionId, archivedAt) {
        database
          .prepare(
            `UPDATE graph_edges
             SET lifecycle_status = 'archived', archived_at = ?,
                 last_changed_in_graph_revision_id = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(archivedAt, graphRevisionId, archivedAt, edgeId);
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
    currentProductBriefId: row.current_product_brief_id,
    currentGraphRevisionId: row.current_graph_revision_id,
    lastReconciledProductBriefVersionId:
      row.last_reconciled_product_brief_version_id,
    productIntentGraphRevisionId: row.product_intent_graph_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProductBrief(row: ProductBriefRow): ProductBrief {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceIdeaId: row.source_idea_id,
    slug: row.slug,
    currentApprovedVersionId: row.current_approved_version_id,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProductBriefVersion(
  row: ProductBriefVersionRow
): ProductBriefVersion {
  return {
    id: row.id,
    productBriefId: row.product_brief_id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    baseApprovedVersionId: row.base_approved_version_id,
    brief: JSON.parse(row.brief_json) as ProductBriefJson,
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    approvedByActorId: row.approved_by_actor_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapGraphDraftBatch(row: GraphDraftBatchRow): GraphDraftBatch {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceProductBriefVersionId: row.source_product_brief_version_id,
    baseGraphRevisionId: row.base_graph_revision_id,
    reconciliationSummary: row.reconciliation_summary,
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    approvedByActorId: row.approved_by_actor_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapGraphDraftBatchChange(
  row: GraphDraftBatchChangeRow
): GraphDraftBatchChange {
  return {
    id: row.id,
    graphDraftBatchId: row.graph_draft_batch_id,
    projectId: row.project_id,
    changeId: row.change_id,
    operation: row.operation,
    entityKind: row.entity_kind,
    targetId: row.target_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    conflict: parseOptionalJson(row.conflict_json),
    createdAt: row.created_at
  };
}

function mapGraphNode(row: GraphNodeRow): GraphNode {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    description: row.description,
    source: row.source,
    sourceRefType: row.source_ref_type,
    sourceRefId: row.source_ref_id,
    lifecycleStatus: row.lifecycle_status,
    createdInGraphRevisionId: row.created_in_graph_revision_id,
    lastChangedInGraphRevisionId: row.last_changed_in_graph_revision_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapGraphEdge(row: GraphEdgeRow): GraphEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    relationType: row.relation_type,
    confidence: row.confidence,
    lifecycleStatus: row.lifecycle_status,
    createdInGraphRevisionId: row.created_in_graph_revision_id,
    lastChangedInGraphRevisionId: row.last_changed_in_graph_revision_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
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
