import { ProductGraphService } from "./application/product-graph-service.js";
import { loadConfig, type AppConfig } from "./config.js";
import {
  openDatabase,
  type SqliteDatabase
} from "./infrastructure/sqlite/database.js";
import { createSqlitePorts } from "./infrastructure/sqlite/repositories.js";

export type App = {
  config: AppConfig;
  database: SqliteDatabase;
  service: ProductGraphService;
  close(): void;
};

export function createApp(config: AppConfig = loadConfig()): App {
  const database = openDatabase(config.databasePath);
  const service = new ProductGraphService(createSqlitePorts(database), {
    actor: {
      id: config.actorId,
      displayName: config.actorDisplayName
    }
  });

  return {
    config,
    database,
    service,
    close() {
      database.close();
    }
  };
}
