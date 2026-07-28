import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, fileURLToPath } from "node:path";

import { ApplicationError } from "../../domain/errors.js";

export type SqliteDatabase = Database.Database;

type OpenDatabaseOptions = {
  migrationsDirectory?: string;
};

type ForeignKeyViolation = {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
};

export function openDatabase(
  databasePath: string,
  options: OpenDatabaseOptions = {}
): SqliteDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  try {
    enableForeignKeys(database);
    runMigrations(
      database,
      options.migrationsDirectory ?? defaultMigrationsDirectory()
    );
    assertReferentialIntegrity(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function enableForeignKeys(database: SqliteDatabase): void {
  database.pragma("foreign_keys = ON");
  const enabled = Number(database.pragma("foreign_keys", { simple: true }));
  if (enabled !== 1) {
    throw new ApplicationError(
      "STORAGE_ERROR",
      "SQLite foreign-key enforcement could not be enabled."
    );
  }
}

function runMigrations(
  database: SqliteDatabase,
  migrationsDirectory: string
): void {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter(file => file.endsWith(".sql"))
    .sort();
  const hasMigrationTable = Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
      )
      .get()
  );
  const applied = hasMigrationTable
    ? new Set(
        (
          database
            .prepare("SELECT version FROM schema_migrations")
            .all() as Array<{ version: string }>
        ).map(row => row.version)
      )
    : new Set<string>();

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }

    const sql = readFileSync(`${migrationsDirectory}/${file}`, "utf8");
    database.transaction(() => {
      database.exec(sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
        )
        .run(file, new Date().toISOString());
    })();
  }
}

function assertReferentialIntegrity(database: SqliteDatabase): void {
  const violations = database.pragma(
    "foreign_key_check"
  ) as ForeignKeyViolation[];
  if (violations.length > 0) {
    throw new ApplicationError(
      "STORAGE_ERROR",
      "SQLite storage integrity check failed.",
      { violations }
    );
  }
}

function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL("../migrations", import.meta.url));
}
