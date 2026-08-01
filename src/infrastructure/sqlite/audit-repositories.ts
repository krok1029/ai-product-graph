// Audit persistence adapter。
//
// Audit logging 與 transaction scoping 的 SQLite adapter。Workflows 透過這些
// ports 讓狀態變更具備 atomicity，並且可以被解釋與追溯。

import type { ApplicationPorts } from "../../application/ports.js";
import type { SqliteDatabase } from "./database.js";
import {
  mapAuditLogEntry,
  stringifyOptional,
  type AuditRow
} from "./row-mappers.js";

export function createAuditRepositories(
  database: SqliteDatabase
): Pick<ApplicationPorts,"auditLog" | "transactions"> {
  return {
    auditLog: {
      append(entry) {
        database
          .prepare(
            `INSERT INTO audit_log (
          id, project_id, actor_type, actor_id, action, entity_type,
          entity_id, before_summary_json, after_summary_json,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            entry.id,
            entry.projectId,
            entry.actorType,
            entry.actorId,
            entry.action,
            entry.entityType,
            entry.entityId,
            stringifyOptional(entry.beforeSummary),
            stringifyOptional(entry.afterSummary),
            JSON.stringify(entry.metadata),
            entry.createdAt
          );
      },
      list() {
        const rows = database
          .prepare(
            `SELECT id, project_id, actor_type, actor_id, action, entity_type,
                entity_id, before_summary_json, after_summary_json,
                metadata_json, created_at
         FROM audit_log ORDER BY created_at, id`
          )
          .all() as AuditRow[];
        return rows.map(mapAuditLogEntry);
      }
    },
    transactions: {
      run<T>(work: () => T): T {
        return database.transaction(work)();
      }
    }
  };
}
