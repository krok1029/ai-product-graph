import type { SyncMappingTerminationRepository } from "../../application/sync-mapping-termination-ports.js";
import { ApplicationError } from "../../domain/errors.js";
import type { Decision } from "../../domain/result-acceptance.js";
import type { SyncMappingTermination } from "../../domain/sync-mapping-termination.js";
import type { SqliteDatabase } from "./database.js";

export function createSyncMappingTerminationRepository(database: SqliteDatabase): SyncMappingTerminationRepository {
  function requireTransaction() {
    if (!database.inTransaction) throw new ApplicationError("STORAGE_ERROR", "Mapping termination requires a transaction.");
  }
  return {
    findByMappingId(mappingId) {
      // 保留原始 scope；讀取端必須能看見壞資料，不能以 JOIN filter 偽裝成沒有 termination。
      const row = database.prepare(`SELECT id, project_id AS projectId, mapping_id AS mappingId,
        decision_id AS decisionId FROM sync_mapping_terminations WHERE mapping_id = ?`)
        .get(mappingId) as Omit<SyncMappingTermination, "stoppedSyncIntentIds"> | undefined;
      if (!row) return null;
      const decision = database.prepare(`SELECT id, project_id AS projectId, decision_type AS decisionType,
        summary, actor_id AS actorId, created_at AS createdAt FROM decisions WHERE id = ?`)
        .get(row.decisionId) as Decision | undefined;
      if (!decision) throw new ApplicationError("CONFLICT", "Mapping termination Decision is missing.", { mappingId });
      const membership = database.prepare(`SELECT m.sync_intent_id AS id FROM sync_mapping_termination_intents m
        LEFT JOIN sync_intents i ON i.id = m.sync_intent_id WHERE m.termination_id = ?
        ORDER BY i.sequence_number, m.sync_intent_id`).all(row.id) as { id: string }[];
      return { termination: { ...row, stoppedSyncIntentIds: membership.map(item => item.id) }, decision };
    },
    insert(value) {
      requireTransaction();
      database.prepare(`INSERT INTO sync_mapping_terminations (id, project_id, mapping_id, decision_id)
        VALUES (?, ?, ?, ?)`).run(value.id, value.projectId, value.mappingId, value.decisionId);
      const insert = database.prepare(`INSERT INTO sync_mapping_termination_intents (termination_id, sync_intent_id) VALUES (?, ?)`);
      for (const intentId of value.stoppedSyncIntentIds) insert.run(value.id, intentId);
    },
    archiveMapping(mappingId, archivedAt) {
      requireTransaction();
      return database.prepare(`UPDATE external_work_item_mappings SET lifecycle_status = 'archived',
        updated_at = ?, archived_at = ? WHERE id = ? AND lifecycle_status = 'active'`)
        .run(archivedAt, archivedAt, mappingId).changes === 1;
    }
  };
}
