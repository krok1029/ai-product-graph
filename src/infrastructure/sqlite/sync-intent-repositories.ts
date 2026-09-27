import { canonicalizeJson } from "../../application/canonical-json.js";
import type { ApplicationPorts } from "../../application/ports.js";
import type { SyncAttempt, SyncIntent } from "../../domain/sync-intent.js";
import type { SqliteDatabase } from "./database.js";

type IntentRow = Omit<SyncIntent, "payload"> & { payloadJson: string };
type AttemptRow = Omit<SyncAttempt, "response" | "error"> & { responseJson: string | null; errorJson: string | null };

const intentColumns = `i.id, i.project_id AS projectId, i.mapping_id AS mappingId,
  i.external_container_id AS externalContainerId, i.sequence_number AS sequenceNumber,
  i.operation, i.source_event_type AS sourceEventType, i.source_event_id AS sourceEventId,
  i.source_ticket_revision_id AS sourceTicketRevisionId, i.payload_hash AS payloadHash,
  i.payload_json AS payloadJson, i.idempotency_key AS idempotencyKey,
  i.supersedes_sync_intent_id AS supersedesSyncIntentId, i.lifecycle_status AS lifecycleStatus,
  i.created_at AS createdAt`;

function mapIntent({ payloadJson, ...row }: IntentRow): SyncIntent {
  return { ...row, payload: JSON.parse(payloadJson) as Record<string, unknown> };
}

export function createSyncIntentRepositories(database: SqliteDatabase): Pick<ApplicationPorts, "syncIntents"> {
  return {
    syncIntents: {
      hasInvalidTicketExportRequests(ticketId) {
        // Source revision 或 payload owner 指向本 Ticket 的 active request 都不能靜默消失。
        const rows = database.prepare(`SELECT ${intentColumns} FROM sync_intents i
          LEFT JOIN ticket_revisions r ON r.id = i.source_ticket_revision_id
          WHERE i.source_event_type = 'plane_ticket_export_requested'
            AND i.lifecycle_status = 'active' AND (r.ticket_id = ? OR json_extract(i.payload_json, '$.owner.id') = ?)`)
          .all(ticketId, ticketId) as IntentRow[];
        const ticket = database.prepare("SELECT project_id AS projectId FROM tickets WHERE id = ?").get(ticketId) as { projectId: string } | undefined;
        return rows.some(row => {
          try {
            const intent = mapIntent(row);
            const revision = database.prepare("SELECT ticket_id AS ticketId, project_id AS projectId FROM ticket_revisions WHERE id = ?")
              .get(intent.sourceTicketRevisionId) as { ticketId: string; projectId: string } | undefined;
            const owner = intent.payload.owner;
            return intent.operation !== "create" || !ticket || !revision || revision.ticketId !== ticketId || revision.projectId !== ticket.projectId ||
              intent.projectId !== ticket.projectId || !owner || typeof owner !== "object" || Array.isArray(owner) ||
              !("type" in owner) || owner.type !== "ticket" || !("id" in owner) || owner.id !== ticketId ||
              intent.payload.source_ticket_revision_id !== intent.sourceTicketRevisionId;
          } catch { return true; }
        });
      },
      findById(id) {
        const row = database.prepare(`SELECT ${intentColumns} FROM sync_intents i WHERE i.id = ?`).get(id) as IntentRow | undefined;
        return row ? mapIntent(row) : null;
      },
      findByIdempotencyKey(key) {
        const row = database.prepare(`SELECT ${intentColumns} FROM sync_intents i WHERE i.idempotency_key = ?`).get(key) as IntentRow | undefined;
        return row ? mapIntent(row) : null;
      },
      insert(intent) {
        database.prepare(`INSERT INTO sync_intents (id, project_id, mapping_id, external_container_id,
          sequence_number, operation, source_event_type, source_event_id, source_ticket_revision_id,
          payload_hash, payload_json, idempotency_key, supersedes_sync_intent_id, lifecycle_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          intent.id, intent.projectId, intent.mappingId, intent.externalContainerId, intent.sequenceNumber,
          intent.operation, intent.sourceEventType, intent.sourceEventId, intent.sourceTicketRevisionId,
          intent.payloadHash, canonicalizeJson(intent.payload), intent.idempotencyKey,
          intent.supersedesSyncIntentId, intent.lifecycleStatus, intent.createdAt
        );
      },
      hasActiveTicketMapping(ticketId, containerId) {
        return Boolean(database.prepare(`SELECT 1 FROM external_work_item_mappings
          WHERE internal_owner_type = 'ticket' AND internal_owner_id = ?
            AND external_container_id = ? AND lifecycle_status = 'active' LIMIT 1`).get(ticketId, containerId));
      },
      hasOutstandingTicketCreate(ticketId, containerId) {
        return Boolean(database.prepare(`SELECT 1 FROM sync_intents i
          JOIN ticket_revisions r ON r.id = i.source_ticket_revision_id
          WHERE r.ticket_id = ? AND i.external_container_id = ?
            AND i.source_event_type = 'plane_ticket_export_requested' AND i.operation = 'create'
            AND i.lifecycle_status = 'active' AND NOT EXISTS (
              SELECT 1 FROM sync_attempts a WHERE a.sync_intent_id = i.id AND a.result_status = 'succeeded'
            ) LIMIT 1`).get(ticketId, containerId));
      },
      listByTicketId(ticketId) {
        const rows = database.prepare(`SELECT ${intentColumns} FROM sync_intents i
          JOIN ticket_revisions r ON r.id = i.source_ticket_revision_id
          JOIN tickets t ON t.id = r.ticket_id
          WHERE t.id = ? AND i.project_id = t.project_id AND r.project_id = t.project_id
            AND i.source_event_type = 'plane_ticket_export_requested' AND i.operation = 'create'
          ORDER BY i.created_at, i.id`).all(ticketId) as IntentRow[];
        return rows.map(mapIntent).filter(intent => {
          const owner = intent.payload.owner;
          return typeof owner === "object" && owner !== null && !Array.isArray(owner) &&
            "type" in owner && owner.type === "ticket" && "id" in owner && owner.id === ticketId &&
            intent.payload.source_ticket_revision_id === intent.sourceTicketRevisionId;
        });
      },
      listByMappingId(mappingId) {
        const rows = database.prepare(`SELECT ${intentColumns} FROM sync_intents i
          WHERE i.mapping_id = ? ORDER BY i.sequence_number, i.id`).all(mappingId) as IntentRow[];
        return rows.map(mapIntent);
      },
      listAttempts(syncIntentId) {
        const rows = database.prepare(`SELECT a.id, a.sync_intent_id AS syncIntentId,
          a.external_work_item_id AS externalWorkItemId, a.operation, a.idempotency_key AS idempotencyKey,
          a.started_at AS startedAt, a.completed_at AS completedAt, a.result_status AS resultStatus,
          a.response_json AS responseJson, a.error_json AS errorJson FROM sync_attempts a
          LEFT JOIN sync_intent_claims c ON c.attempt_id = a.id
          WHERE a.sync_intent_id = ? ORDER BY a.started_at, COALESCE(c.sequence, 0), a.id`).all(syncIntentId) as AttemptRow[];
        return rows.map(({ responseJson, errorJson, ...row }) => ({ ...row,
          response: responseJson === null ? null : JSON.parse(responseJson) as unknown,
          error: errorJson === null ? null : JSON.parse(errorJson) as unknown
        }));
      }
    }
  };
}
