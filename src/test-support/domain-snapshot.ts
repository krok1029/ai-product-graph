import type { SqliteDatabase } from "../infrastructure/sqlite/database.js";

// Handoff 只允許新增觀測 audit 與初始化／更新 server actor，其餘持久化資料必須不變。
export function domainSnapshot(database: SqliteDatabase) {
  const tables = database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' AND name NOT IN ('audit_log', 'local_actors') ORDER BY name`)
    .all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name,
    database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()
  ]));
}
