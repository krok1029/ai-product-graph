import type { ExternalWorkItemWriteRepository } from "../../application/external-work-item-write-ports.js";
import { canonicalizeJson } from "../../application/canonical-json.js";
import type { SqliteDatabase } from "./database.js";

export function createExternalWorkItemWriteRepository(database: SqliteDatabase): ExternalWorkItemWriteRepository {
  return {
    insertCreatedProjection({ externalWorkItem: item, mapping, snapshot }) {
      if (!database.inTransaction) throw new Error("External projection requires an active transaction.");
      database.prepare(`INSERT INTO external_work_items (id, external_container_id, provider, external_id,
        external_url, lifecycle_status, metadata_json, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(item.id, item.externalContainerId, item.provider,
        item.externalId, item.externalUrl, item.lifecycleStatus, canonicalizeJson(item.metadata),
        item.createdAt, item.updatedAt, item.archivedAt);
      database.prepare(`INSERT INTO external_work_item_mappings (id, project_id, internal_owner_type,
        internal_owner_id, external_container_id, external_work_item_id, source_ticket_revision_id,
        lifecycle_status, next_sequence_number, metadata_json, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(mapping.id, mapping.projectId,
        mapping.internalOwnerType, mapping.internalOwnerId, mapping.externalContainerId,
        mapping.externalWorkItemId, mapping.sourceTicketRevisionId, mapping.lifecycleStatus,
        mapping.nextSequenceNumber, canonicalizeJson(mapping.metadata), mapping.createdAt,
        mapping.updatedAt, mapping.archivedAt);
      database.prepare(`INSERT INTO external_work_item_snapshots (id, project_id, external_work_item_id,
        mapping_id, content_json, external_status, concurrency_token, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(snapshot.id, snapshot.projectId, snapshot.externalWorkItemId,
        snapshot.mappingId, canonicalizeJson(snapshot.content), snapshot.externalStatus,
        snapshot.concurrencyToken, snapshot.capturedAt);
    }
  };
}
