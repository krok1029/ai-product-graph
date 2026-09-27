import { PlaneHttpProvider } from "../plane/http-provider.js";
import { PlaneObservationWorkflow } from "../../application/plane-observation-workflow.js";
import { planeManagedContent } from "../plane/managed-content.js";
import { loadConfig } from "../../config.js";
import { ApplicationError } from "../../domain/errors.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";

const help = `Usage: pnpm plane:observe -- <mapping-id>
       node dist/plane-observe.js <mapping-id>

Read one existing active Plane mapping and record its content observation.
Required: AI_PRODUCT_GRAPH_PLANE_BASE_URL, AI_PRODUCT_GRAPH_PLANE_API_KEY
Database: AI_PRODUCT_GRAPH_DB_PATH (defaults to data/ai-product-graph.sqlite)

A captured mismatch is successful detection (exit 0); it does not resolve drift.
Each invocation records a new snapshot. No remote content or status is changed.
`;

type CommandResult = { exitCode: number; output: string };

export async function runPlaneObserve(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  // pnpm 可能把分隔符原樣傳入；只接受一個明確 ID，不支援批次或隱含掃描。
  const values = args[0] === "--" ? args.slice(1) : args;
  if (values.length === 1 && (values[0] === "--help" || values[0] === "-h")) {
    return { exitCode: 0, output: help };
  }
  const mappingId = values[0];
  if (values.length !== 1 || !mappingId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(mappingId)) {
    return failure("INVALID_ARGUMENTS", "Provide exactly one mapping ID, or --help.", 2);
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
    const config = loadConfig(env);
    database = openDatabase(config.databasePath);
    const workflow = new PlaneObservationWorkflow(createSqlitePorts(database), provider, planeManagedContent, {
      actor: { id: config.actorId, displayName: config.actorDisplayName }
    });
    const outcome = await workflow.observe(mappingId);
    return { exitCode: outcome.status === "captured" ? 0 : 1,
      output: JSON.stringify({ ...outcome, mappingId }) + "\n" };
  } catch (error) {
    if (error instanceof ApplicationError) {
      return failure(error.code, error.code === "NOT_FOUND"
        ? "The requested mapping was not found."
        : "The mapping cannot be observed in its current state.");
    }
    // SQLite／provider exception 可能含路徑、輸入或秘密；CLI 不回傳原始訊息或 stack。
    return failure("OBSERVATION_FAILED", "The observation could not be saved locally.");
  } finally {
    database?.close();
  }
}

function failure(code: string, message: string, exitCode = 1): CommandResult {
  return { exitCode, output: JSON.stringify({ status: "error", code, message }) + "\n" };
}
