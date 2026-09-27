import { randomUUID } from "node:crypto";
import { PlaneHttpProvider } from "../plane/http-provider.js";
import { createPlaneCreateProcessor } from "../../application/create-plane-create-processor.js";
import { loadConfig } from "../../config.js";
import { ApplicationError } from "../../domain/errors.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";

const help = `Usage: pnpm plane:export -- <sync-intent-id>
       node dist/plane-export.js <sync-intent-id>

Process one existing Plane first-export create intent.
Required: AI_PRODUCT_GRAPH_PLANE_BASE_URL, AI_PRODUCT_GRAPH_PLANE_API_KEY
Database: AI_PRODUCT_GRAPH_DB_PATH (defaults to data/ai-product-graph.sqlite)

Only create/reconciliation runs. Update, close and reopen intents stay pending.
An uncertain previous create is reconciled; an empty lookup never retries POST.
`;

type CommandResult = { exitCode: number; output: string };

export async function runPlaneExport(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  // pnpm 可能把分隔符原樣傳入；只接受一個明確 ID，不支援批次或隱含掃描。
  const values = args[0] === "--" ? args.slice(1) : args;
  if (values.length === 1 && (values[0] === "--help" || values[0] === "-h")) {
    return { exitCode: 0, output: help };
  }
  const intentId = values[0];
  if (values.length !== 1 || !intentId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(intentId)) {
    return failure("INVALID_ARGUMENTS", "Provide exactly one Sync Intent ID, or --help.", 2);
  }
  const baseUrl = env.AI_PRODUCT_GRAPH_PLANE_BASE_URL;
  const apiKey = env.AI_PRODUCT_GRAPH_PLANE_API_KEY;
  if (!baseUrl || !apiKey) {
    return failure("INVALID_CONFIGURATION", "Set the Plane base URL and API key environment variables.", 2);
  }
  let provider: PlaneHttpProvider;
  try {
    provider = new PlaneHttpProvider({ baseUrl, apiKey, timeoutMs: 15_000 });
  } catch {
    return failure("INVALID_CONFIGURATION", "The Plane connection configuration is invalid.", 2);
  }
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    database = openDatabase(loadConfig(env).databasePath);
    const processor = createPlaneCreateProcessor(createSqlitePorts(database), provider);
    // Lease 留下 HTTP deadline 之外的本機提交時間；每次 process 使用獨立 worker identity。
    const outcome = await processor.process(intentId, `plane-cli:${randomUUID()}`, 60_000);
    return { exitCode: outcome.status === "succeeded" || outcome.status === "already_succeeded" ? 0 : 1,
      output: JSON.stringify({ intentId, ...outcome }) + "\n" };
  } catch (error) {
    if (error instanceof ApplicationError) {
      return failure(error.code, error.code === "NOT_FOUND"
        ? "The requested Sync Intent was not found."
        : "The Sync Intent cannot be processed in its current state.");
    }
    // SQLite／provider exception 可能含路徑、輸入或秘密；CLI 不回傳原始訊息或 stack。
    return failure("EXPORT_FAILED", "Export did not complete locally. Inspect the durable Sync Intent history before retrying.");
  } finally {
    database?.close();
  }
}

function failure(code: string, message: string, exitCode = 1): CommandResult {
  return { exitCode, output: JSON.stringify({ status: "error", code, message }) + "\n" };
}
