import { resolve } from "node:path";

export type AppConfig = {
  databasePath: string;
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): AppConfig {
  return {
    databasePath:
      env.AI_PRODUCT_GRAPH_DB_PATH ??
      resolve(cwd, "data/ai-product-graph.sqlite")
  };
}
