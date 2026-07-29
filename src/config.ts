import { resolve } from "node:path";

export type AppConfig = {
  databasePath: string;
  actorId: string;
  actorDisplayName: string;
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): AppConfig {
  return {
    databasePath:
      env.AI_PRODUCT_GRAPH_DB_PATH ??
      resolve(cwd, "data/ai-product-graph.sqlite"),
    actorId:
      env.AI_PRODUCT_GRAPH_ACTOR_ID ?? "00000000000000000000000001",
    actorDisplayName:
      env.AI_PRODUCT_GRAPH_ACTOR_NAME ?? "Local User"
  };
}
