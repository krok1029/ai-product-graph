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
      findById(id) {
        const row = database.prepare(`SELECT ${intentColumns} FROM sync_intents i WHERE i.id = ?`).get(id) as IntentRow | undefined;
        return row ? mapIntent(row) : null;
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
      listAttempts(syncIntentId) {
        const rows = database.prepare(`SELECT id, sync_intent_id AS syncIntentId,
          external_work_item_id AS externalWorkItemId, operation, idempotency_key AS idempotencyKey,
          started_at AS startedAt, completed_at AS completedAt, result_status AS resultStatus,
          response_json AS responseJson, error_json AS errorJson FROM sync_attempts
          WHERE sync_intent_id = ? ORDER BY started_at, id`).all(syncIntentId) as AttemptRow[];
        return rows.map(({ responseJson, errorJson, ...row }) => ({ ...row,
          response: responseJson === null ? null : JSON.parse(responseJson) as unknown,
          error: errorJson === null ? null : JSON.parse(errorJson) as unknown
        }));
      }
    }
  };
}
