import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ulid } from "ulid";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { createPlaneCreateProcessor } from "./create-plane-create-processor.js";
import { ProductGraphService } from "./product-graph-service.js";
import { openDatabase, type SqliteDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { SyncAttemptClaims } from "./sync-attempt-claims.js";

let f: ReturnType<typeof acceptanceFixture>;
const directories: string[] = [];
beforeEach(() => { f = acceptanceFixture(); });
afterEach(() => { f.database.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("stops failed close and pending update with one Decision and preserves every historical outcome", async () => {
  const { mapping } = await exportMapping();
  const accepted = f.service.acceptImplementationResult({ implementationResultId: f.submit().implementationResult.id, idempotencyKey: "accept" });
  const close = f.ports.syncIntents.listByMappingId(mapping.id)[0]!;
  attempt(close.id, "failed");
  f.service.approveTicketRevision(draft().id);
  const intents = f.ports.syncIntents.listByMappingId(mapping.id);
  const before = history(f.database);
  const ticketBefore = f.ports.tickets.findById(f.ticket.id);
  const clockBefore = f.clockCalls();
  const auditBefore = f.ports.auditLog.list().length;

  const result = f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "  Provider retired  " });

  expect(result.termination).toEqual({ id: result.termination.id, projectId: f.project.id,
    mappingId: mapping.id, decisionId: result.decision.id, stoppedSyncIntentIds: intents.map(intent => intent.id) });
  expect(result.decision).toEqual({ id: result.decision.id, projectId: f.project.id,
    decisionType: "sync_mapping_termination", summary: "Provider retired", actorId: "acceptance-user", createdAt: result.mapping.archivedAt });
  expect(result.mapping).toEqual({ ...mapping, nextSequenceNumber: intents.length + 1,
    lifecycleStatus: "archived", updatedAt: result.decision.createdAt, archivedAt: result.decision.createdAt });
  expect(f.clockCalls()).toBe(clockBefore + 1);
  expect(f.ports.auditLog.list()).toHaveLength(auditBefore + 1);
  expect(f.ports.auditLog.list().find(entry => entry.id === result.auditLogId)).toMatchObject({ id: result.auditLogId, action: "sync_mapping.terminated", actorId: "acceptance-user" });
  expect(history(f.database)).toBe(before);
  expect(f.ports.tickets.findById(f.ticket.id)).toEqual(ticketBefore);
  expect(f.service.getTicketSyncHealth(f.ticket.id)).toMatchObject({ syncHealth: "current", activeMappingCount: 0 });
  // 原 acceptance receipt 必須逐位元保留；不重新提交或覆寫驗收結果。
  const receipt = f.database.prepare("SELECT response_json FROM operation_receipts WHERE response_audit_log_id = ?").get(accepted.auditLogId) as { response_json: string };
  expect(JSON.parse(receipt.response_json)).toEqual(accepted.data);
});

it("can terminate a healthy mapping without a failure or complete create proof", async () => {
  const { mapping } = await exportMapping();
  f.database.prepare("UPDATE external_work_item_mappings SET metadata_json = '{}' WHERE id = ?").run(mapping.id);
  const target = f.service;

  const result = target.terminateSyncMapping({ mappingId: mapping.id, reason: "No longer needed" });

  expect(result.termination.stoppedSyncIntentIds).toEqual([]);
  expect(target.getTicketSyncHealth(f.ticket.id).activeMappingCount).toBe(0);
  expect(f.ports.syncMappingTerminations.findByMappingId(mapping.id)).toEqual({ termination: result.termination, decision: result.decision });
});

it("includes archived and started obligations but excludes any intent with a successful attempt", async () => {
  const { mapping } = await exportMapping();
  f.service.approveTicketRevision(draft().id);
  f.service.approveTicketRevision(draft().id);
  f.service.approveTicketRevision(draft().id);
  const [first, second, third] = f.ports.syncIntents.listByMappingId(mapping.id);
  attempt(first!.id, "succeeded");
  attempt(first!.id, "failed");
  attempt(second!.id, "started");
  f.database.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = ?").run(third!.id);
  const before = history(f.database);

  const result = f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop future scheduling" });

  expect(result.termination.stoppedSyncIntentIds).toEqual([second!.id, third!.id]);
  expect(history(f.database)).toBe(before);
});

it("allows archived owners and item and leaves another failed mapping counted", async () => {
  const first = await exportMapping("first");
  const second = await exportMapping("second");
  f.service.approveTicketRevision(draft().id);
  attempt(f.ports.syncIntents.listByMappingId(second.mapping.id)[0]!.id, "failed");
  f.database.prepare("UPDATE external_work_items SET lifecycle_status = 'archived' WHERE id = ?").run(first.mapping.externalWorkItemId);
  f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
  f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
  const secondBefore = f.ports.externalWorkItems.findMappingById(second.mapping.id);
  const itemBefore = f.ports.externalWorkItems.findById(first.mapping.externalWorkItemId);

  f.service.terminateSyncMapping({ mappingId: first.mapping.id, reason: "Stop" });

  expect(f.service.getTicketSyncHealth(f.ticket.id)).toMatchObject({ syncHealth: "failed", activeMappingCount: 1 });
  expect(f.ports.externalWorkItems.findMappingById(second.mapping.id)).toEqual(secondBefore);
  expect(f.ports.externalWorkItems.findById(first.mapping.externalWorkItemId)).toEqual(itemBefore);
});

it.each([{ reason: " " }, { reason: "Stop", actorId: "intruder" }, { reason: "Stop", projectId: "other" },
  { reason: "Stop", createdAt: "yesterday" }, { reason: "Stop", decisionId: "injected" }])("rejects invalid command with no durable writes: %j", async fields => {
  const { mapping } = await exportMapping();
  const before = fullSnapshot(f.database);

  expect(() => f.service.terminateSyncMapping({ mappingId: mapping.id, ...fields })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));

  expect(fullSnapshot(f.database)).toBe(before);
});

it.each(["unknown", "archived", "scope"])("rejects %s mapping and rolls back new actor", async scenario => {
  const { mapping } = await exportMapping();
  if (scenario === "archived") f.database.prepare("UPDATE external_work_item_mappings SET lifecycle_status = 'archived' WHERE id = ?").run(mapping.id);
  if (scenario === "scope") {
    const other = f.service.createProject({ name: "Other" }).project;
    f.database.prepare("UPDATE external_work_item_mappings SET project_id = ? WHERE id = ?").run(other.id, mapping.id);
  }
  const target = new ProductGraphService(f.ports, { actor: { id: "new-actor", displayName: "New" } });
  const before = fullSnapshot(f.database);

  expect(() => target.terminateSyncMapping({ mappingId: scenario === "unknown" ? "missing" : mapping.id, reason: "Stop" }))
    .toThrow(expect.objectContaining({ code: scenario === "unknown" ? "NOT_FOUND" : "CONFLICT" }));

  expect(fullSnapshot(f.database)).toBe(before);
});

it("rejects cross-project mapped intent identity without demanding complete attempt proof", async () => {
  const { mapping } = await exportMapping();
  f.service.approveTicketRevision(draft().id);
  const other = f.service.createProject({ name: "Other" }).project;
  f.database.prepare("UPDATE sync_intents SET project_id = ? WHERE mapping_id = ?").run(other.id, mapping.id);
  const before = fullSnapshot(f.database);

  expect(() => f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" }))
    .toThrow(expect.objectContaining({ code: "CONFLICT" }));

  expect(fullSnapshot(f.database)).toBe(before);
});

it.each(["decision", "membership", "archive", "audit"])("rolls back all effects including actor on %s failure", async failure => {
  const { mapping } = await exportMapping();
  f.service.approveTicketRevision(draft().id);
  const operations = { decision: "INSERT ON decisions", membership: "INSERT ON sync_mapping_termination_intents",
    archive: "UPDATE ON external_work_item_mappings", audit: "INSERT ON audit_log" };
  f.database.exec(`CREATE TRIGGER fail_termination BEFORE ${operations[failure as keyof typeof operations]} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  const before = fullSnapshot(f.database);
  const target = new ProductGraphService(f.ports, { actor: { id: "new-actor", displayName: "New" } });

  expect(() => target.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" })).toThrow("injected failure");

  expect(fullSnapshot(f.database)).toBe(before);
});

it("replays old create without provider calls and allows new-key independent enrollment", async () => {
  const { mapping, intent, processor, mockCreate } = await exportMapping();
  f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" });
  const before = history(f.database);

  expect(await processor.process(intent.id, "replay")).toMatchObject({ status: "already_succeeded" });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(history(f.database)).toBe(before);
  expect(f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: intent.externalContainerId, idempotencyKey: "mapped" }).syncIntent).toEqual(intent);
  const next = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: intent.externalContainerId, idempotencyKey: "new-key" }).syncIntent;
  const nextProcessor = createPlaneCreateProcessor(f.ports, { create: async () => ({ status: "succeeded", item: {
    externalId: "replacement", externalUrl: null, content: {}, externalStatus: "open", concurrencyToken: "v2"
  } }), reconcile: async () => { throw new Error("unexpected reconcile"); } });
  await nextProcessor.process(next.id, "new");

  expect(f.ports.externalWorkItems.listTicketMappings(f.ticket.id).map(item => item.lifecycleStatus).sort()).toEqual(["active", "archived"]);
});

it.each(["approval-first", "termination-first"])("serializes %s across SQLite connections and persists on restart", async order => {
  const { mapping } = await exportMapping();
  const revision = draft();
  const path = await backup();
  const first = openDatabase(path);
  const second = openDatabase(path);
  const firstService = new ProductGraphService(createSqlitePorts(first));
  const secondService = new ProductGraphService(createSqlitePorts(second));
  try {
    let stopped: string[];
    if (order === "approval-first") {
      const approved = firstService.approveTicketRevision(revision.id);
      stopped = secondService.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" }).termination.stoppedSyncIntentIds;
      expect(stopped).toEqual(approved.createdSyncIntentIds);
      expect(stopped).toHaveLength(1);
    } else {
      stopped = secondService.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" }).termination.stoppedSyncIntentIds;
      expect(firstService.approveTicketRevision(revision.id).createdSyncIntentIds).toEqual([]);
      expect(stopped).toEqual([]);
    }
    const before = history(first);
    first.close(); second.close();
    const reopened = openDatabase(path);
    try {
      const ports = createSqlitePorts(reopened);
      expect(ports.syncMappingTerminations.findByMappingId(mapping.id)!.termination.stoppedSyncIntentIds).toEqual(stopped);
      expect(new ProductGraphService(ports).getTicketSyncHealth(f.ticket.id).activeMappingCount).toBe(0);
      expect(history(reopened)).toBe(before);
    } finally { reopened.close(); }
  } finally { if (first.open) first.close(); if (second.open) second.close(); }
});

it("concurrent termination callers record exactly one Decision and return explicit original termination conflict", async () => {
  const { mapping } = await exportMapping();
  const path = await backup();
  const script = `import { openDatabase } from './src/infrastructure/sqlite/database.ts';
    import { createSqlitePorts } from './src/infrastructure/sqlite/repositories.ts';
    import { ProductGraphService } from './src/application/product-graph-service.ts';
    const db = openDatabase(process.argv[1]);
    try { const result = new ProductGraphService(createSqlitePorts(db)).terminateSyncMapping({ mappingId: process.argv[2], reason: 'Stop' });
      console.log(JSON.stringify({ id: result.termination.id })); }
    catch (error) { console.log(JSON.stringify({ code: error.code, details: error.details })); }
    finally { db.close(); }`;
  const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path, mapping.id]);

  const results = (await Promise.all([run(), run()])).map(result => JSON.parse(result.stdout));

  const success = results.find(result => result.id);
  expect(results.filter(result => result.id)).toHaveLength(1);
  expect(results.find(result => result.code)).toEqual({ code: "CONFLICT", details: { termination_id: success.id } });
  const reopened = openDatabase(path);
  try {
    expect(reopened.prepare("SELECT COUNT(*) AS count FROM decisions WHERE decision_type = 'sync_mapping_termination'").get()).toEqual({ count: 1 });
  } finally { reopened.close(); }
});

it("keeps mapped operation claims rejected after termination and enforces immutable membership", async () => {
  const { mapping } = await exportMapping();
  f.service.approveTicketRevision(draft().id);
  const intent = f.ports.syncIntents.listByMappingId(mapping.id)[0]!;
  const result = f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" });

  expect(() => new SyncAttemptClaims(f.ports.syncClaims).claim(intent.id, "worker", 60_000)).toThrow();
  expect(() => f.database.prepare("DELETE FROM sync_mapping_termination_intents WHERE termination_id = ?").run(result.termination.id)).toThrow("immutable");
  expect(() => f.database.prepare("UPDATE decisions SET summary = 'changed' WHERE id = ?").run(result.decision.id)).toThrow("immutable");
  expect(() => f.ports.syncMappingTerminations.archiveMapping(mapping.id, result.decision.createdAt)).toThrow("requires a transaction");
});

async function exportMapping(containerIdentity = "mapped") {
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity }).externalContainer;
  const intent = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: containerIdentity }).syncIntent;
  const mockCreate = vi.fn(async () => ({ status: "succeeded" as const, item: {
    externalId: containerIdentity, externalUrl: null, content: { name: "Observed" }, externalStatus: "open", concurrencyToken: "v1"
  } }));
  const processor = createPlaneCreateProcessor(f.ports, { create: mockCreate, reconcile: async () => { throw new Error("unexpected reconcile"); } });
  await processor.process(intent.id, "test");
  return { mapping: f.ports.externalWorkItems.listTicketMappings(f.ticket.id).find(mapping => mapping.externalContainerId === container.id)!, intent, processor, mockCreate };
}
function draft() {
  const revision = f.ports.ticketRevisions.findById(f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!)!;
  const spec = revision.specification;
  return f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: revision.id,
    sourceGraphRevisionId: revision.sourceGraphRevisionId, specification: { title: "Replacement", userStory: spec.user_story,
      scope: spec.scope, acceptanceCriteria: spec.acceptance_criteria.map(item => item.text), nonGoals: spec.non_goals,
      relatedGraphNodeIds: spec.related_graph_node_ids, implementationNotes: spec.implementation_notes,
      implementationTargets: revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope })) } }).revision;
}
function attempt(intentId: string, status: "failed" | "succeeded" | "started") {
  const intent = f.ports.syncIntents.findById(intentId)!;
  const mapping = f.ports.externalWorkItems.findMappingById(intent.mappingId!)!;
  // Mapped processor 尚未交付；此 fixture 保存既有格式的真實 outcome，不偽裝遠端呼叫。
  f.database.prepare(`INSERT INTO sync_attempts (id, sync_intent_id, external_work_item_id, operation, idempotency_key,
    started_at, completed_at, result_status, error_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(ulid(), intent.id, mapping.externalWorkItemId, intent.operation, intent.idempotencyKey,
      "2026-09-27T12:00:00.000Z", status === "started" ? null : "2026-09-27T12:00:01.000Z", status,
      status === "failed" ? '{"code":"FAILED"}' : null);
}
function history(database: SqliteDatabase) {
  return JSON.stringify(["sync_intents", "sync_attempts", "sync_intent_claims", "external_work_item_snapshots", "operation_receipts"]
    .map(table => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}
function fullSnapshot(database: SqliteDatabase) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  return JSON.stringify(tables.map(({ name }) => database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()));
}
async function backup() {
  const directory = mkdtempSync(join(tmpdir(), "mapping-termination-")); directories.push(directory);
  const path = join(directory, "db.sqlite"); await f.database.backup(path); return path;
}
