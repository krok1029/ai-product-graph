import { ApplicationError } from "../../domain/errors.js";
import type { ExternalWorkItemRepository } from "../../application/external-work-item-ports.js";
import type { ExternalWorkItem, ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../../domain/external-work-item.js";
import type { SqliteDatabase } from "./database.js";

type ItemRow = Omit<ExternalWorkItem, "metadata"> & { metadataJson: string };
type MappingRow = Omit<ExternalWorkItemMapping, "metadata"> & { metadataJson: string };
type SnapshotRow = Omit<ExternalWorkItemSnapshot, "content"> & { contentJson: string };

const mappingColumns = `m.id, m.project_id AS projectId, m.internal_owner_type AS internalOwnerType,
  m.internal_owner_id AS internalOwnerId, m.external_container_id AS externalContainerId,
  m.external_work_item_id AS externalWorkItemId, m.source_ticket_revision_id AS sourceTicketRevisionId,
  m.lifecycle_status AS lifecycleStatus, m.next_sequence_number AS nextSequenceNumber,
  m.metadata_json AS metadataJson, m.created_at AS createdAt, m.updated_at AS updatedAt,
  m.archived_at AS archivedAt`;

// 歷史 lifecycle 不影響可讀性；所有查詢共用相同的 identity boundary，避免分支漏查 scope。
const validMappingJoins = `FROM external_work_item_mappings m
  JOIN tickets t ON m.internal_owner_type = 'ticket' AND t.id = m.internal_owner_id AND t.project_id = m.project_id
  JOIN external_containers c ON c.id = m.external_container_id AND c.provider = 'plane'
  JOIN external_work_items i ON i.id = m.external_work_item_id AND i.external_container_id = c.id AND i.provider = c.provider
  LEFT JOIN ticket_revisions r ON r.id = m.source_ticket_revision_id`;
const validRevision = `(m.source_ticket_revision_id IS NULL OR (r.ticket_id = t.id AND r.project_id = t.project_id))`;

function mapMetadata<T extends { metadataJson: string }>({ metadataJson, ...row }: T) {
  return { ...row, metadata: JSON.parse(metadataJson) as unknown };
}

export function createExternalWorkItemRepository(database: SqliteDatabase): ExternalWorkItemRepository {
  function mappings(predicate: string, id: string) {
    const rows = database.prepare(`SELECT ${mappingColumns} ${validMappingJoins}
      WHERE ${validRevision} AND ${predicate} ORDER BY m.created_at, m.id`).all(id) as MappingRow[];
    return rows.map(mapMetadata);
  }
  function snapshots(predicate: string, id: string) {
    const rows = database.prepare(`SELECT s.id, s.project_id AS projectId,
      s.external_work_item_id AS externalWorkItemId, s.mapping_id AS mappingId,
      s.content_json AS contentJson, s.external_status AS externalStatus,
      s.concurrency_token AS concurrencyToken, s.captured_at AS capturedAt ${validMappingJoins}
      JOIN external_work_item_snapshots s ON s.mapping_id = m.id
        AND s.project_id = m.project_id AND s.external_work_item_id = m.external_work_item_id
      WHERE ${validRevision} AND ${predicate} ORDER BY s.captured_at, s.id`).all(id) as SnapshotRow[];
    return rows.map(({ contentJson, ...row }) => ({ ...row, content: JSON.parse(contentJson) as unknown }));
  }
  return {
    findById(id) {
      const row = database.prepare(`SELECT i.id, i.external_container_id AS externalContainerId,
        i.provider, i.external_id AS externalId, i.external_url AS externalUrl,
        i.lifecycle_status AS lifecycleStatus, i.metadata_json AS metadataJson,
        i.created_at AS createdAt, i.updated_at AS updatedAt, i.archived_at AS archivedAt
        FROM external_work_items i JOIN external_containers c ON c.id = i.external_container_id
        WHERE i.id = ? AND i.provider = 'plane' AND c.provider = i.provider`).get(id) as ItemRow | undefined;
      return row ? mapMetadata(row) : null;
    },
    findMappingById(mappingId) {
      const mapping = mappings("m.id = ?", mappingId)[0];
      if (mapping) return mapping;
      if (database.prepare("SELECT 1 FROM external_work_item_mappings WHERE id = ?").get(mappingId)) {
        throw new ApplicationError("CONFLICT", "Plane mapping has invalid identity provenance.", {
          mappingId, reason: "invalid_obligation"
        });
      }
      return null;
    },
    listTicketMappings: ticketId => mappings("t.id = ?", ticketId),
    listItemMappings: itemId => mappings("i.id = ?", itemId),
    listMappingSnapshots: mappingId => snapshots("m.id = ?", mappingId),
    listItemSnapshots: itemId => snapshots("i.id = ?", itemId)
  };
}
