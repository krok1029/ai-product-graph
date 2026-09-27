import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PlaneHttpProvider } from "../plane/http-provider.js";
import { createPlaneCreateProcessor } from "../../application/create-plane-create-processor.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";

let directory: string;
let databasePath: string;
let server: Server;
let baseUrl: string;
let intentId: string;
let ticketId: string;
let calls: { method: string; url: string; key: string | undefined; body: unknown }[];
let remoteItem: Record<string, unknown> | null;
const apiKey = "loopback-only-test-key";

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "apg-plane-cli-"));
  databasePath = join(directory, "local.sqlite");
  calls = [];
  remoteItem = null;
  server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body: unknown = text ? JSON.parse(text) : null;
    calls.push({ method: request.method!, url: request.url!, key: request.headers["x-api-key"] as string | undefined, body });
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST") {
      remoteItem = { ...(body as Record<string, unknown>), id: "remote-item", project: "project",
        state: "open-state", updated_at: "2026-09-27T00:00:00.000Z", labels: ["external-label"] };
      response.writeHead(201).end(JSON.stringify(remoteItem));
    } else {
      response.writeHead(remoteItem ? 200 : 404).end(JSON.stringify(remoteItem ?? { error: "missing" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const fixture = acceptanceFixture();
  try {
    const container = fixture.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
    ticketId = fixture.ticket.id;
    intentId = fixture.service.requestPlaneTicketExport({ ticketId, sourceTicketRevisionId: fixture.revision.id,
      externalContainerId: container.id, idempotencyKey: "cli-export" }).syncIntent.id;
    await fixture.database.backup(databasePath);
  } finally { fixture.database.close(); }
});

afterEach(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  rmSync(directory, { recursive: true, force: true });
});

it("exports through a real child process and replays success without a second POST", async () => {
  // 前置：SQLite 已保存由 application 明確要求的 first-export intent。
  const original = inspect(ports => ports.syncIntents.findById(intentId));

  // 操作：透過正式 entrypoint 執行一次，再以另一個 process 重試。
  const first = await cli([intentId]);
  const second = await cli([intentId]);

  // 驗證：唯一 external mapping、完整 snapshot 與 trace 已落地，原始 intent 不變。
  expect(first.code).toBe(0);
  expect(first.stderr).toBe("");
  const outcome = JSON.parse(first.stdout);
  expect(outcome).toMatchObject({ intentId, status: "succeeded", attemptId: expect.any(String), externalWorkItemId: expect.any(String) });
  expect(JSON.parse(second.stdout)).toEqual({ ...outcome, status: "already_succeeded" });
  expect(second.code).toBe(0);
  expect(calls.map(call => call.method)).toEqual(["POST"]);
  expect(calls[0]).toMatchObject({ key: apiKey, url: "/api/v1/workspaces/workspace/projects/project/work-items/",
    body: { external_source: "ai-product-graph", external_id: original!.idempotencyKey, name: "Deliver feature" } });
  inspect((ports, database) => {
    expect(ports.syncIntents.findById(intentId)).toEqual(original);
    const service = new ProductGraphService(ports);
    const history = service.listTicketExternalWorkItems(ticketId);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]!.externalWorkItem.id).toBe(outcome.externalWorkItemId);
    expect(history.items[0]!.snapshots[0]!.content).toEqual(remoteItem);
    expect(database.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_node_id = ? AND relation_type = 'traces_to'").get(outcome.externalWorkItemId)).toEqual({ count: 1 });
    expect(ports.syncIntents.listAttempts(intentId).map(attempt => attempt.resultStatus)).toEqual(["succeeded"]);
  });
});

it("recovers remote success after a failed local commit by GET reconciliation in a restarted CLI", async () => {
  // 前置：使用真實 HTTP 與已過期的注入 clock 模擬前次 process，不等待真實 lease 時間。
  const database = openDatabase(databasePath);
  const ports = createSqlitePorts(database);
  database.exec(`CREATE TRIGGER fail_local_export BEFORE INSERT ON external_work_items
    BEGIN SELECT RAISE(ABORT, 'local projection failure'); END`);
  const target = createPlaneCreateProcessor(ports, new PlaneHttpProvider({ baseUrl, apiKey }),
    { clock: () => new Date(Date.now() - 120_000) });
  await expect(target.process(intentId, "prior-process", 1000)).rejects.toThrow("local projection failure");
  expect(ports.syncIntents.listAttempts(intentId).map(attempt => attempt.resultStatus)).toEqual(["started"]);
  expect(ports.externalWorkItems.listTicketMappings(ticketId)).toEqual([]);
  database.exec("DROP TRIGGER fail_local_export");
  database.close();

  // 操作：正式 CLI 在新 process 重新打開同一 SQLite 並 reconciliation。
  const recovered = await cli([intentId]);

  // 驗證：沒有重送 POST，歷史失敗保留且只有一份 mapping。
  expect(recovered.code).toBe(0);
  expect(JSON.parse(recovered.stdout)).toMatchObject({ intentId, status: "succeeded" });
  expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
  expect(new URL(calls[1]!.url, baseUrl).searchParams.get("external_source")).toBe("ai-product-graph");
  inspect(ports => {
    expect(ports.externalWorkItems.listTicketMappings(ticketId)).toHaveLength(1);
    expect(ports.syncIntents.listAttempts(intentId).map(attempt => attempt.resultStatus)).toEqual(["failed", "succeeded"]);
  });
});

it("shows help without credentials or opening a database", async () => {
  // 前置：指定尚不存在的 database path，移除所有 Plane credential。
  const missing = join(directory, "not-created.sqlite");
  const result = await cli(["--help"], { AI_PRODUCT_GRAPH_PLANE_API_KEY: "", AI_PRODUCT_GRAPH_PLANE_BASE_URL: "", AI_PRODUCT_GRAPH_DB_PATH: missing });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Usage:");
  expect(existsSync(missing)).toBe(false);
  expect(calls).toEqual([]);
});

it.each([[], ["*"], ["one", "another"], ["--all"]].map(args => ({ args })))
("rejects invalid argument shape $args without provider invocation", async ({ args }) => {
  const result = await cli(args);
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "INVALID_ARGUMENTS" });
  expect(calls).toEqual([]);
});

it("rejects missing configuration and sanitizes invalid configuration errors", async () => {
  const missing = await cli([intentId], { AI_PRODUCT_GRAPH_PLANE_API_KEY: "" });
  const invalid = await cli([intentId], { AI_PRODUCT_GRAPH_PLANE_BASE_URL: `https://${apiKey}@plane.invalid` });
  expect(missing.code).toBe(2);
  expect(invalid.code).toBe(2);
  expect(JSON.parse(invalid.stderr)).toMatchObject({ code: "INVALID_CONFIGURATION" });
  expect(invalid.stderr).not.toContain(apiKey);
  expect(calls).toEqual([]);
});

it("returns nonzero for a missing intent without creating a provider attempt", async () => {
  const result = await cli(["missing-intent"]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "NOT_FOUND" });
  expect(calls).toEqual([]);
  inspect(ports => expect(ports.syncIntents.listAttempts(intentId)).toEqual([]));
});

it("keeps an uncertain create failed when reconciliation finds no item", async () => {
  // 前置：前次 invocation 可能已送出，但其結果不明。
  const database = openDatabase(databasePath);
  const ports = createSqlitePorts(database);
  const target = createPlaneCreateProcessor(ports, {
    async create() { return { status: "unknown", error: { code: "TIMEOUT" } }; },
    async reconcile() { throw new Error("Not used in setup"); }
  });
  await target.process(intentId, "prior-process");
  database.close();

  // 操作：CLI 重試；測試 HTTP 回傳 404。
  const result = await cli([intentId]);

  // 驗證：沒有第二個 create，兩次失敗均保留，CLI 回 nonzero。
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ intentId, status: "failed", attemptId: expect.any(String) });
  expect(calls.map(call => call.method)).toEqual(["GET"]);
  inspect(ports => {
    expect(ports.externalWorkItems.listTicketMappings(ticketId)).toEqual([]);
    expect(ports.syncIntents.listAttempts(intentId).map(attempt => attempt.resultStatus)).toEqual(["failed", "failed"]);
  });
});

it("rejects non-create intents and leaves enrolled updates pending", async () => {
  // 前置：完成首次匯出，再由真實 approval workflow 產生 update intent。
  expect((await cli([intentId])).code).toBe(0);
  const updateId = inspect((ports) => {
    const service = new ProductGraphService(ports);
    const ticket = ports.tickets.findById(ticketId)!;
    const revision = ports.ticketRevisions.findById(ticket.currentApprovedRevisionId!)!;
    const spec = revision.specification;
    const replacement = service.createTicketRevisionDraft({ ticketId, baseApprovedRevisionId: revision.id,
      sourceGraphRevisionId: revision.sourceGraphRevisionId, specification: { title: "Next content", userStory: spec.user_story,
        scope: spec.scope, acceptanceCriteria: spec.acceptance_criteria.map(value => value.text), nonGoals: spec.non_goals,
        relatedGraphNodeIds: spec.related_graph_node_ids, implementationNotes: spec.implementation_notes,
        implementationTargets: revision.requiredTargets.map(value => ({ repositoryId: value.repository_id, scope: value.scope })) } });
    return service.approveTicketRevision(replacement.revision.id).createdSyncIntentIds[0]!;
  });

  // 操作：CLI 收到 mapping update intent。
  const result = await cli([updateId]);

  // 驗證：不呼叫 provider、不建立 attempt，仍保留 pending obligation。
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "CONFLICT" });
  expect(calls.map(call => call.method)).toEqual(["POST"]);
  inspect(ports => expect(ports.syncIntents.listAttempts(updateId)).toEqual([]));
});

function inspect<T>(read: (ports: ReturnType<typeof createSqlitePorts>, database: ReturnType<typeof openDatabase>) => T): T {
  const database = openDatabase(databasePath);
  try { return read(createSqlitePorts(database), database); } finally { database.close(); }
}
function cli(args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", resolve("src/plane-export.ts"), ...args], {
      env: { ...process.env, AI_PRODUCT_GRAPH_DB_PATH: databasePath, AI_PRODUCT_GRAPH_PLANE_BASE_URL: baseUrl,
        AI_PRODUCT_GRAPH_PLANE_API_KEY: apiKey, ...overrides }, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("CLI subprocess exceeded test deadline")); }, 20_000);
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => { clearTimeout(timeout); resolveResult({ code, stdout, stderr }); });
  });
}
