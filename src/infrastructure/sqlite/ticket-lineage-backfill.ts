// 只從目前 approved revision（否則第一版 draft）重建有效 lineage。
// Pending replacement 不得提前改變 graph；無效舊資料使 migration 整筆回滾。
import { ulid } from "ulid";
import { ApplicationError } from "../../domain/errors.js";
import type { SqliteDatabase } from "./database.js";

export function backfillTicketLineage(database: SqliteDatabase): void {
  const rows = database.prepare(`SELECT t.id AS ticket_id, t.project_id, r.id AS revision_id,
    r.specification_json, r.created_at, r.approved_at
    FROM tickets t JOIN ticket_revisions r ON r.id = COALESCE(t.current_approved_revision_id,
      (SELECT initial.id FROM ticket_revisions initial WHERE initial.ticket_id = t.id
        ORDER BY initial.revision_number, initial.id LIMIT 1))`).all() as Array<{
      ticket_id: string; project_id: string; revision_id: string; specification_json: string;
      created_at: string; approved_at: string | null;
    }>;
  const insert = database.prepare(`INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id,
    relation_type, confidence, lifecycle_status, created_in_graph_revision_id, last_changed_in_graph_revision_id,
    metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'traces_to', NULL, 'active', NULL, NULL, ?, ?, ?)`);
  for (const row of rows) {
    const specification = JSON.parse(row.specification_json) as { traces_to_ticket_id?: unknown };
    const target = specification.traces_to_ticket_id;
    if (target === undefined || target === null) continue;
    const original = typeof target === "string" ? database.prepare("SELECT project_id FROM tickets WHERE id = ?").get(target) as
      { project_id: string } | undefined : undefined;
    if (!original || original.project_id !== row.project_id || target === row.ticket_id) {
      throw new ApplicationError("STORAGE_ERROR", "Legacy Ticket lineage is invalid.", { ticketId: row.ticket_id, target });
    }
    const at = row.approved_at ?? row.created_at;
    insert.run(ulid(), row.project_id, row.ticket_id, target,
      JSON.stringify({ owner_ticket_id: row.ticket_id, established_by_ticket_revision_id: row.revision_id }), at, at);
  }
}
