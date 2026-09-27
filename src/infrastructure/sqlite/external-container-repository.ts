import type { ExternalContainerRepository } from "../../application/external-container-ports.js";
import type { ExternalContainer } from "../../domain/external-container.js";
import type { SqliteDatabase } from "./database.js";

const columns = `id, provider, workspace_identity AS workspaceIdentity,
  container_identity AS containerIdentity, display_name AS displayName,
  created_at AS createdAt, updated_at AS updatedAt`;

export function createExternalContainerRepository(database: SqliteDatabase): ExternalContainerRepository {
  return {
    insert(value) {
      database.prepare(`INSERT INTO external_containers
        (id, provider, workspace_identity, container_identity, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.provider, value.workspaceIdentity,
        value.containerIdentity, value.displayName, value.createdAt, value.updatedAt);
    },
    findById(id) {
      return database.prepare(`SELECT ${columns} FROM external_containers WHERE id = ?`)
        .get(id) as ExternalContainer | undefined ?? null;
    },
    findByIdentity(identity) {
      return database.prepare(`SELECT ${columns} FROM external_containers
        WHERE provider = ? AND workspace_identity = ? AND container_identity = ?`)
        .get(identity.provider, identity.workspaceIdentity, identity.containerIdentity) as ExternalContainer | undefined ?? null;
    },
    list(provider) {
      const filter = provider === undefined ? "" : " WHERE provider = ?";
      return database.prepare(`SELECT ${columns} FROM external_containers${filter} ORDER BY created_at, id`)
        .all(...(provider === undefined ? [] : [provider])) as ExternalContainer[];
    }
  };
}
