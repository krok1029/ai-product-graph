// 歷史讀取與單筆處置共用 evidence validator，單筆讀取不掃描無關 observation 或同步歷史。
import type { PlaneObservationReadRepository } from "../../application/plane-observation-read-ports.js";
import type { SqliteDatabase } from "./database.js";
import { createExternalWorkItemRepository } from "./external-work-item-repository.js";
import { driftSelect, invalid, observationSelect, validateDrift, validateObservationEvidence,
  type DriftRow, type ObservationRow } from "./plane-observation-evidence.js";

export function createPlaneObservationReadRepository(database: SqliteDatabase): PlaneObservationReadRepository {
  return {
    readDrift(contentDriftId) {
      const row = database.prepare(`${driftSelect} WHERE d.id = ?`).get(contentDriftId) as DriftRow | undefined;
      if (!row) return null;
      let mapping;
      try { mapping = createExternalWorkItemRepository(database).findMappingById(row.mappingId); }
      catch (error) { if (error instanceof SyntaxError) invalid(row.mappingId); throw error; }
      if (!mapping || !database.prepare("SELECT 1 FROM projects WHERE id = ?").get(mapping.projectId)) invalid(row.mappingId);
      const observation = database.prepare(`${observationSelect} WHERE o.snapshot_id = ?`)
        .get(row.externalWorkItemSnapshotId) as ObservationRow | undefined;
      const sibling = database.prepare("SELECT id FROM content_drifts WHERE snapshot_id = ? AND id <> ? LIMIT 1")
        .get(row.externalWorkItemSnapshotId, row.id);
      if (!observation || sibling) invalid(mapping.id);
      const captured = validateObservationEvidence(observation, mapping);
      const drift = validateDrift(row, mapping, captured);
      return { mapping, drift, snapshot: captured.snapshot, observation: captured.provenance };
    },
    readHistory(mapping) {
      // 以兩端已知關係選取後再驗證，不以 inner join 吞掉損壞的歷史資料。
      const rows = database.prepare(`${observationSelect}
        WHERE o.mapping_id = ? OR s.mapping_id = ? ORDER BY s.captured_at, o.snapshot_id`)
        .all(mapping.id, mapping.id) as ObservationRow[];
      const observations = rows.map(row => validateObservationEvidence(row, mapping));
      const bySnapshot = new Map(observations.map(value => [value.snapshot.id, value]));
      const driftRows = database.prepare(`${driftSelect}
        WHERE d.mapping_id = ? OR s.mapping_id = ? OR o.mapping_id = ? ORDER BY d.detected_at, d.id`)
        .all(mapping.id, mapping.id, mapping.id) as DriftRow[];
      const seen = new Set<string>();
      const drifts = driftRows.map(row => {
        if (seen.has(row.externalWorkItemSnapshotId)) invalid(mapping.id);
        seen.add(row.externalWorkItemSnapshotId);
        return validateDrift(row, mapping, bySnapshot.get(row.externalWorkItemSnapshotId));
      });
      return { observations, drifts };
    }
  };
}
