// Ticket persistence adapter。
//
// Ticket drafts、ticket identities 與 versioned Ticket Revisions 的 SQLite
// adapter。連接 revisions、graph nodes 與 dependencies 的 join tables 放在
// 這裡，因為它們屬於 revision snapshot 的一部分。

import type { ApplicationPorts } from "../../application/ports.js";
import type { SqliteDatabase } from "./database.js";
import {
  mapTicket,
  mapTicketDraftBatch,
  mapTicketRevision,
  type TicketDraftBatchRow,
  type TicketRevisionRow,
  type TicketRow
} from "./row-mappers.js";

export function createTicketRepositories(
  database: SqliteDatabase
): Pick<
  ApplicationPorts,
  "ticketDraftBatches" | "tickets" | "ticketRevisions"
> {
  return {
    ticketDraftBatches: {
      insert(batch) {
        database
          .prepare(
            `INSERT INTO ticket_draft_batches (
          id, project_id, source_graph_revision_id, lifecycle_status,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            batch.id,
            batch.projectId,
            batch.sourceGraphRevisionId,
            batch.lifecycleStatus,
            batch.createdAt,
            batch.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, source_graph_revision_id,
                lifecycle_status, created_at, updated_at
         FROM ticket_draft_batches WHERE id = ?`
          )
          .get(id) as TicketDraftBatchRow|undefined;
        return row? mapTicketDraftBatch(row):null;
      }
    },
    tickets: {
      setDeliveryStatus(ticketId, status, updatedAt) {
        database.prepare("UPDATE tickets SET delivery_status = ?, updated_at = ? WHERE id = ?").run(status, updatedAt, ticketId);
      },
      listByProjectId(projectId) {
        const rows = database.prepare(
          `SELECT id, project_id, slug, title, current_approved_revision_id,
                  lifecycle_status, delivery_status, created_at, updated_at
           FROM tickets WHERE project_id = ? ORDER BY created_at, id`
        ).all(projectId) as TicketRow[];
        return rows.map(mapTicket);
      },
      insert(ticket) {
        database
          .prepare(
            `INSERT INTO tickets (
          id, project_id, slug, title, current_approved_revision_id,
          lifecycle_status, delivery_status, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            ticket.id,
            ticket.projectId,
            ticket.slug,
            ticket.title,
            ticket.currentApprovedRevisionId,
            ticket.lifecycleStatus,
            ticket.deliveryStatus,
            ticket.createdAt,
            ticket.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, slug, title,
                current_approved_revision_id, lifecycle_status,
                delivery_status, created_at, updated_at
         FROM tickets WHERE id = ?`
          )
          .get(id) as TicketRow|undefined;
        return row? mapTicket(row):null;
      },
      findBySlug(projectId, slug) {
        const row = database
          .prepare(
            `SELECT id, project_id, slug, title,
                current_approved_revision_id, lifecycle_status,
                delivery_status, created_at, updated_at
         FROM tickets WHERE project_id = ? AND slug = ?`
          )
          .get(projectId, slug) as TicketRow|undefined;
        return row? mapTicket(row):null;
      },
      updateCurrentApprovedRevision(
        ticketId,
        expectedRevisionId,
        revisionId,
        title,
        deliveryStatus,
        updatedAt
      ) {
        const result = database
          .prepare(
            `UPDATE tickets
         SET current_approved_revision_id = ?, title = ?,
             delivery_status = ?, updated_at = ?
         WHERE id = ?
           AND lifecycle_status = 'active'
           AND current_approved_revision_id IS ?`
          )
          .run(
            revisionId,
            title,
            deliveryStatus,
            updatedAt,
            ticketId,
            expectedRevisionId
          );
        return result.changes === 1;
      }
    },
    ticketRevisions: {
      insert(revision, relatedGraphNodeIds, dependencyTicketIds) {
        database
          .prepare(
            `INSERT INTO ticket_revisions (
          id, ticket_id, project_id, ticket_draft_batch_id,
          revision_number, base_approved_revision_id,
          source_graph_revision_id, title, specification_json,
          required_targets_json, review_status, lifecycle_status,
          approved_by_actor_id, approved_at, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            revision.id,
            revision.ticketId,
            revision.projectId,
            revision.ticketDraftBatchId,
            revision.revisionNumber,
            revision.baseApprovedRevisionId,
            revision.sourceGraphRevisionId,
            revision.title,
            JSON.stringify(revision.specification),
            JSON.stringify(revision.requiredTargets),
            revision.reviewStatus,
            revision.lifecycleStatus,
            revision.approvedByActorId,
            revision.approvedAt,
            revision.createdAt,
            revision.updatedAt
          );
        const graphNodeStatement = database.prepare(
          `INSERT INTO ticket_revision_graph_nodes (
        ticket_revision_id, graph_node_id, relation_type, created_at
      ) VALUES (?, ?, 'traces_to', ?)`
        );
        for (const nodeId of relatedGraphNodeIds) {
          graphNodeStatement.run(revision.id, nodeId, revision.createdAt);
        }
        const dependencyStatement = database.prepare(
          `INSERT INTO ticket_revision_dependencies (
        ticket_revision_id, depends_on_ticket_id, created_at
      ) VALUES (?, ?, ?)`
        );
        for (const dependencyId of dependencyTicketIds) {
          dependencyStatement.run(
            revision.id,
            dependencyId,
            revision.createdAt
          );
        }
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, ticket_id, project_id, ticket_draft_batch_id,
                revision_number, base_approved_revision_id,
                source_graph_revision_id, title, specification_json,
                required_targets_json, review_status, lifecycle_status,
                approved_by_actor_id, approved_at, created_at, updated_at
         FROM ticket_revisions WHERE id = ?`
          )
          .get(id) as TicketRevisionRow|undefined;
        return row? mapTicketRevision(row):null;
      },
      listByTicketId(ticketId) {
        const rows = database
          .prepare(
            `SELECT id, ticket_id, project_id, ticket_draft_batch_id,
                revision_number, base_approved_revision_id,
                source_graph_revision_id, title, specification_json,
                required_targets_json, review_status, lifecycle_status,
                approved_by_actor_id, approved_at, created_at, updated_at
         FROM ticket_revisions
         WHERE ticket_id = ?
         ORDER BY revision_number, id`
          )
          .all(ticketId) as TicketRevisionRow[];
        return rows.map(mapTicketRevision);
      },
      nextRevisionNumber(ticketId) {
        const row = database
          .prepare(
            `SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision_number
         FROM ticket_revisions WHERE ticket_id = ?`
          )
          .get(ticketId) as { revision_number: number };
        return row.revision_number;
      },
      approve(revisionId, actorId, approvedAt) {
        database
          .prepare(
            `UPDATE ticket_revisions
         SET review_status = 'approved', approved_by_actor_id = ?,
             approved_at = ?, updated_at = ?
         WHERE id = ?`
          )
          .run(actorId, approvedAt, approvedAt, revisionId);
      },
      archiveStaleDrafts(
        ticketId,
        exceptRevisionId,
        currentApprovedRevisionId,
        archivedAt
      ) {
        const rows = database
          .prepare(
            `SELECT id
         FROM ticket_revisions
         WHERE ticket_id = ?
           AND id <> ?
           AND review_status = 'draft'
           AND lifecycle_status = 'active'
           AND base_approved_revision_id IS NOT ?
         ORDER BY revision_number, id`
          )
          .all(
            ticketId,
            exceptRevisionId,
            currentApprovedRevisionId
          ) as Array<{ id: string }>;
        if (rows.length>0) {
          const placeholders = rows.map(() => "?").join(", ");
          database
            .prepare(
              `UPDATE ticket_revisions
           SET lifecycle_status = 'archived', archived_at = ?,
               updated_at = ?
           WHERE id IN (${placeholders})`
            )
            .run(archivedAt, archivedAt,...rows.map(row => row.id));
        }
        return rows.map(row => row.id);
      },
      listGraphNodeIds(revisionId) {
        const rows = database
          .prepare(
            `SELECT graph_node_id
         FROM ticket_revision_graph_nodes
         WHERE ticket_revision_id = ?
         ORDER BY rowid`
          )
          .all(revisionId) as Array<{ graph_node_id: string }>;
        return rows.map(row => row.graph_node_id);
      },
      listDependencyTicketIds(revisionId) {
        const rows = database
          .prepare(
            `SELECT depends_on_ticket_id
         FROM ticket_revision_dependencies
         WHERE ticket_revision_id = ?
         ORDER BY rowid`
          )
          .all(revisionId) as Array<{ depends_on_ticket_id: string }>;
        return rows.map(row => row.depends_on_ticket_id);
      }
    },
  };
}
