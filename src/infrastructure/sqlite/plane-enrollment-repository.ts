import type { PlaneEnrollmentRepository } from "../../application/plane-enrollment-ports.js";
import { ApplicationError } from "../../domain/errors.js";
import type { SqliteDatabase } from "./database.js";

export function createPlaneEnrollmentRepository(database: SqliteDatabase): PlaneEnrollmentRepository {
  return {
    allocateSequence(mappingId, now) {
      if (!database.inTransaction) throw new ApplicationError("CONFLICT", "Mapping sequence allocation requires a transaction.");
      const row = database.prepare(`UPDATE external_work_item_mappings
        SET next_sequence_number = next_sequence_number + 1, updated_at = ?
        WHERE id = ? AND lifecycle_status = 'active' AND internal_owner_type = 'ticket'
          AND next_sequence_number >= 1 AND next_sequence_number < 9007199254740991
        RETURNING next_sequence_number - 1 AS sequence`).get(now, mappingId) as { sequence: number } | undefined;
      if (!row) throw new ApplicationError("CONFLICT", "Active mapping sequence could not be allocated.");
      return row.sequence;
    }
  };
}
