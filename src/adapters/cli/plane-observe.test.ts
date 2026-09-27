import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPlaneCreateProcessor } from "../../application/create-plane-create-processor.js";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { planeCreateFields } from "../plane/fields.js";

let directory: string;
let databasePath: string;
let server: Server;
let baseUrl: string;
let mappingId: string;
let revisionId: string;
let remoteItem: Record<string, unknown>;
let responseStatus: number;
let calls: { method: string; url: string; key: string | undefined }[];
const apiKey = "observe-loopback-secret";
const actorId = "observation-cli-actor";

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "apg-observe-cli-"));
  databasePath = join(directory, "local.sqlite");
  calls = [];
  responseStatus = 200;
  server = createServer((request, response) => {
    calls.push({ method: request.method!, url: request.url!, key: request.headers["x-api-key"] as string | undefined });
    response.writeHead(responseStatus, { "Content-Type": "application/json" }).end(JSON.stringify(remoteItem));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const f = acceptanceFixture();
  try {
    revisionId = f.revision.id;
    const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
    const intent = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: revisionId,
      externalContainerId: container.id, idempotencyKey: "observe-cli-setup" }).syncIntent;
    await createPlaneCreateProcessor(f.ports, {
      async create(request) {
        remoteItem = { ...planeCreateFields(request), id: "remote-item", project: "project", state: "open-state",
          updated_at: "2026-09-27T00:00:00.000Z", labels: ["external-label"] };
        return { status: "succeeded", item: { externalId: "remote-item", externalUrl: null,
          content: remoteItem, externalStatus: "open-state", concurrencyToken: "2026-09-27T00:00:00.000Z" } };
      },
      async reconcile() { throw new Error("Not used by setup"); }
    }).process(intent.id, "setup");
    mappingId = f.ports.externalWorkItems.listTicketMappings(f.ticket.id)[0]!.id;
    await f.database.backup(databasePath);
  } finally { f.database.close(); }
});

afterEach(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  rmSync(directory, { recursive: true, force: true });
});

it("captures matching content through the real entrypoint and retains a distinct snapshot after restart", async () => {
  // 前置：已有成功 create 的 mapping，先保存 outbound 證據。
  const original = inspect((ports) => ports.syncIntents.listAttempts(
    (ports.externalWorkItems.findMappingById(mappingId)!.metadata as { created_by_sync_intent_id: string }).created_by_sync_intent_id));
  const first = await cli([mappingId]);
  expect(first.code).toBe(0);
  const firstResult = JSON.parse(first.stdout);

  // 操作：另一個 process 明確再次觀測相同內容。
  const second = await cli(["--", mappingId]);

  // 驗證：每次 GET 獨立保存，不改寫成功 outbound proof。
  expect(second.code).toBe(0);
  expect(first.stderr + second.stderr).toBe("");
  const secondResult = JSON.parse(second.stdout);
  expect(firstResult).toMatchObject({ status: "captured", mappingId, sourceTicketRevisionId: revisionId,
    contentDriftId: null, snapshotId: expect.any(String), auditLogId: expect.any(String) });
  expect(secondResult).toMatchObject({ status: "captured", contentDriftId: null });
  expect(secondResult.snapshotId).not.toBe(firstResult.snapshotId);
  expect(calls).toEqual([1, 2].map(() => ({ method: "GET", key: apiKey,
    url: "/api/v1/workspaces/workspace/projects/project/work-items/remote-item/" })));
  inspect((ports, database) => {
    expect(database.prepare("SELECT snapshot_id, source_ticket_revision_id, actor_id FROM plane_observations ORDER BY snapshot_id").all())
      .toEqual([firstResult.snapshotId, secondResult.snapshotId].sort().map(snapshot_id => ({ snapshot_id, source_ticket_revision_id: revisionId, actor_id: actorId })));
    expect(database.prepare("SELECT COUNT(*) AS count FROM content_drifts").get()).toEqual({ count: 0 });
    expect(ports.syncIntents.listAttempts(original[0]!.syncIntentId)).toEqual(original);
  });
});

it("returns exit zero for captured drift while preserving external-only fields", async () => {
  // 前置：外部修改 title 並刪除 marker，其他內容保留。
  remoteItem.name = "Edited externally";
  delete remoteItem.external_id;

  // 操作：明確讀取這個 mapping。
  const result = await cli([mappingId]);

  // 驗證：偵測成功與同步成功分開，差異及完整 snapshot 已落地。
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  const outcome = JSON.parse(result.stdout);
  expect(outcome).toMatchObject({ status: "captured", contentDriftId: expect.any(String) });
  inspect((_ports, database) => {
    const drift = database.prepare("SELECT * FROM content_drifts WHERE id = ?").get(outcome.contentDriftId) as { diff_json: string; resolution_decision_id: null };
    expect(JSON.parse(drift.diff_json)).toMatchObject({ schema_version: 1, source_ticket_revision_id: revisionId,
      changes: [{ field: "name", expected: "Deliver feature", observed: { present: true, value: "Edited externally" } },
        { field: "external_id", observed: { present: false } }] });
    expect(drift.resolution_decision_id).toBeNull();
    const snapshot = database.prepare("SELECT content_json FROM external_work_item_snapshots WHERE id = ?").get(outcome.snapshotId) as { content_json: string };
    expect(JSON.parse(snapshot.content_json)).toEqual(remoteItem);
  });
  expect(calls.map(call => call.method)).toEqual(["GET"]);
});

it.each([[], ["*"], ["one", "two"], ["--all"]].map(args => ({ args })))
("rejects invalid arguments $args without database or network access", async ({ args }) => {
  // 前置：尚不存在的 database。
  const missing = join(directory, "missing.sqlite");
  // 操作：送出不支援的參數。
  const result = await cli(args, { AI_PRODUCT_GRAPH_DB_PATH: missing });
  // 驗證：參數錯誤不啟動任何操作。
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "INVALID_ARGUMENTS" });
  expect(existsSync(missing)).toBe(false);
  expect(calls).toEqual([]);
});

it("shows help without credentials or creating a database", async () => {
  // 前置：不提供連線設定，database 尚不存在。
  const missing = join(directory, "missing.sqlite");
  // 操作：要求 help。
  const result = await cli(["--help"], { AI_PRODUCT_GRAPH_DB_PATH: missing, AI_PRODUCT_GRAPH_PLANE_API_KEY: "", AI_PRODUCT_GRAPH_PLANE_BASE_URL: "" });
  // 驗證：help 不依賴設定或持久化。
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Usage: pnpm plane:observe");
  expect(result.stderr).toBe("");
  expect(existsSync(missing)).toBe(false);
  expect(calls).toEqual([]);
});

it.each(["", `https://${apiKey}@plane.invalid`])("rejects invalid configuration without exposing credentials (%s)", async base => {
  // 前置：缺少或不合法的 origin。
  const missing = join(directory, "missing.sqlite");
  // 操作：提供不合法設定。
  const result = await cli([mappingId], { AI_PRODUCT_GRAPH_DB_PATH: missing, AI_PRODUCT_GRAPH_PLANE_BASE_URL: base });
  // 驗證：只回傳固定錯誤，不開啟資料庫。
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "INVALID_CONFIGURATION" });
  expect(result.stderr).not.toContain(apiKey);
  expect(existsSync(missing)).toBe(false);
  expect(calls).toEqual([]);
});

it("rejects unknown mappings before contacting Plane", async () => {
  // 前置：傳入不存在的 mapping ID。
  // 操作：執行正式命令。
  const result = await cli(["missing-mapping"]);
  // 驗證：沒有外部請求或 observation。
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "NOT_FOUND" });
  expect(calls).toEqual([]);
  expectCaptureCount(0);
});

it("rejects terminated mappings before contacting Plane", async () => {
  // 前置：使用正式 application workflow 終止 mapping。
  inspect(ports => new ProductGraphService(ports).terminateSyncMapping({ mappingId, reason: "No longer used" }));
  // 操作：命令不能再次觀測已退出的 mapping。
  const result = await cli([mappingId]);
  // 驗證：保留 termination，沒有 GET 或新 snapshot。
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "CONFLICT" });
  expect(calls).toEqual([]);
  expectCaptureCount(0);
});

it.each([404, 401, 500])("sanitizes HTTP %i without capturing the error response", async status => {
  // 前置：provider 回傳可能含秘密的錯誤內容。
  responseStatus = status;
  remoteItem = { error: apiKey, url: baseUrl };
  // 操作：執行一次讀取。
  const result = await cli([mappingId]);
  // 驗證：沒有重試、原始 body 或成功 capture。
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toMatchObject({ status: "unknown", mappingId, error: { http_status: status } });
  expect(result.stderr).not.toContain(apiKey);
  expect(result.stderr).not.toContain(baseUrl);
  expect(calls.map(call => call.method)).toEqual(["GET"]);
  expectCaptureCount(0);
});

it("rejects a known mapping with a non-Plane container before network access", async () => {
  // 前置：模擬持久化 scope 損壞，mapping 的 container 已不是 Plane。
  inspect((_ports, database) => database.prepare(`UPDATE external_containers SET provider = 'github'
    WHERE id = (SELECT external_container_id FROM external_work_item_mappings WHERE id = ?)` ).run(mappingId));
  // 操作：讀取仍存在的 mapping。
  const result = await cli([mappingId]);
  // 驗證：不能將 scope 不符誤當成可讀的 Plane item。
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ code: "CONFLICT" });
  expect(calls).toEqual([]);
  expectCaptureCount(0);
});

it("sanitizes connection failure and leaves no successful capture", async () => {
  // 前置：停止 loopback server，原 port 不再接受連線。
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  // 操作：明確讀取一次。
  const result = await cli([mappingId]);
  // 驗證：不洩漏 origin、credential 或 stack。
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ status: "unknown", mappingId });
  expect(result.stderr).not.toContain(baseUrl);
  expect(result.stderr).not.toContain(apiKey);
  expect(result.stderr).not.toContain(" at ");
  expectCaptureCount(0);
});

it("sanitizes local commit failure and rolls back the complete observation", async () => {
  // 前置：在 SQLite capture 寫入點注入含敏感文字的錯誤。
  inspect((_ports, database) => database.exec(`CREATE TRIGGER fail_observation BEFORE INSERT ON plane_observations
    BEGIN SELECT RAISE(ABORT, 'observe-loopback-secret'); END`));
  // 操作：GET 成功後的本機 commit 失敗。
  const result = await cli([mappingId]);
  // 驗證：沒有部分 snapshot 或成功摘要。
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toEqual({ status: "error", code: "OBSERVATION_FAILED", message: "The observation could not be saved locally." });
  expect(result.stderr).not.toContain(apiKey);
  expectCaptureCount(0);
  inspect((_ports, database) => {
    expect(database.prepare("SELECT COUNT(*) AS count FROM external_work_item_snapshots").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'plane_mapping.observed'").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM local_actors WHERE id = ?").get(actorId)).toEqual({ count: 0 });
  });
});

function expectCaptureCount(count: number) {
  inspect((_ports, database) => expect(database.prepare("SELECT COUNT(*) AS count FROM plane_observations").get()).toEqual({ count }));
}
function inspect<T>(read: (ports: ReturnType<typeof createSqlitePorts>, database: ReturnType<typeof openDatabase>) => T): T {
  const database = openDatabase(databasePath);
  try { return read(createSqlitePorts(database), database); } finally { database.close(); }
}
function cli(args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", resolve("src/plane-observe.ts"), ...args], {
      env: { ...process.env, AI_PRODUCT_GRAPH_DB_PATH: databasePath, AI_PRODUCT_GRAPH_PLANE_BASE_URL: baseUrl,
        AI_PRODUCT_GRAPH_PLANE_API_KEY: apiKey, AI_PRODUCT_GRAPH_ACTOR_ID: actorId,
        AI_PRODUCT_GRAPH_ACTOR_NAME: "Observation CLI", ...overrides }, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Observation CLI exceeded test deadline")); }, 20_000);
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => { clearTimeout(timeout); done({ code, stdout, stderr }); });
  });
}
