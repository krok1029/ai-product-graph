// Graph persistence adapter。
//
// Graph Draft Batch、不可變 Graph Revision，以及 active/archived graph
// nodes/edges 的 SQLite adapter。GraphWorkflow 負責領域規則；這個 module
// 只負責保存 workflow 已經決定好的狀態變更。

import type { ApplicationPorts } from "../../application/ports.js";
import type { SqliteDatabase } from "./database.js";
import {
  mapGraphDraftBatch,
  mapGraphDraftBatchChange,
  mapGraphEdge,
  mapGraphNode,
  mapGraphRevision,
  stringifyOptional,
  type GraphDraftBatchChangeRow,
  type GraphDraftBatchRow,
  type GraphEdgeRow,
  type GraphNodeRow,
  type GraphRevisionRow
} from "./row-mappers.js";

export function createGraphRepositories(
  database: SqliteDatabase
): Pick<
  ApplicationPorts,
  | "graphDraftBatches"
  | "graphRevisions"
  | "graphNodes"
  | "graphEdges"
> {
  return {
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
          .get(id) as GraphDraftBatchRow|undefined;
        return row? mapGraphDraftBatch(row):null;
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
        if (rows.length>0) {
          const placeholders = rows.map(() => "?").join(", ");
          database
            .prepare(
              `UPDATE graph_draft_batches
           SET lifecycle_status = 'archived', archived_at = ?,
               updated_at = ?
           WHERE id IN (${placeholders})`
            )
            .run(archivedAt, archivedAt,...rows.map(row => row.id));
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
            revision.isNoopReconciliation? 1:0,
            revision.reconciliationSummary,
            revision.createdAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, graph_draft_batch_id,
                source_product_brief_version_id, sequence_number,
                is_noop_reconciliation, reconciliation_summary, created_at
         FROM graph_revisions WHERE id = ?`
          )
          .get(id) as GraphRevisionRow|undefined;
        return row? mapGraphRevision(row):null;
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
          .get(id) as GraphNodeRow|undefined;
        return row? mapGraphNode(row):null;
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
          .get(projectId, slug) as GraphNodeRow|undefined;
        return row? mapGraphNode(row):null;
      },
      list(projectId, lifecycleStatus) {
        const sql = `SELECT id, project_id, slug, type, title, description,
                        source, source_ref_type, source_ref_id,
                        lifecycle_status, created_in_graph_revision_id,
                        last_changed_in_graph_revision_id, metadata_json,
                        created_at, updated_at
                 FROM graph_nodes
                 WHERE project_id = ?${lifecycleStatus? " AND lifecycle_status = ?":""
          }
                 ORDER BY type, slug, id`;
        const rows = lifecycleStatus
          ? (database.prepare(sql).all(
            projectId,
            lifecycleStatus
          ) as GraphNodeRow[])
          :(database.prepare(sql).all(projectId) as GraphNodeRow[]);
        return rows.map(mapGraphNode);
      },
      update(nodeId, input) {
        const assignments = [
          "source_ref_type = 'product_brief_version'",
          "source_ref_id = ?",
          "last_changed_in_graph_revision_id = ?",
          "updated_at = ?"
        ];
        const values: unknown[]= [
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
          .get(id) as GraphEdgeRow|undefined;
        return row? mapGraphEdge(row):null;
      },
      list(projectId, lifecycleStatus) {
        const sql = `SELECT id, project_id, source_node_id, target_node_id,
                        relation_type, confidence, lifecycle_status,
                        created_in_graph_revision_id,
                        last_changed_in_graph_revision_id, metadata_json,
                        created_at, updated_at
                 FROM graph_edges
                 WHERE project_id = ?${lifecycleStatus? " AND lifecycle_status = ?":""
          }
                 ORDER BY relation_type, source_node_id, target_node_id, id`;
        const rows = lifecycleStatus
          ? (database.prepare(sql).all(
            projectId,
            lifecycleStatus
          ) as GraphEdgeRow[])
          :(database.prepare(sql).all(projectId) as GraphEdgeRow[]);
        return rows.map(mapGraphEdge);
      },
      update(edgeId, input) {
        const assignments = [
          "last_changed_in_graph_revision_id = ?",
          "updated_at = ?"
        ];
        const values: unknown[]= [input.graphRevisionId, input.updatedAt];
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
  };
}
