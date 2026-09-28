import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";
import { createPlaneCreateProcessor } from "../../application/create-plane-create-processor.js";
import { MappingSyncReads } from "../../application/mapping-sync-reads.js";
import { hashJson, planeExportPayload } from "../../application/plane-export-payload.js";
import type { SyncIntent } from "../../domain/sync-intent.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createFullMcpServer as createMcpServer } from "../../test-support/full-mcp-server.js";
import type { ToolEnvelope } from "./tool-envelope.js";

let f: ReturnType<typeof acceptanceFixture>;
let counter = 1000;
const clock = () => new Date("2026-09-27T02:00:00.000Z");
const cleanup: Array<() => void> = [];
beforeEach(() => { f = acceptanceFixture(); counter = 1000; });
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); f.database.close(); });

async function exported(name: string, retry = false) {
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: name }).externalContainer;
  const intent = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: name }).syncIntent;
  const item = { externalId: `remote-${name}`, externalUrl: null, externalStatus: "backlog", concurrencyToken: "v1",
    content: JSON.parse('{"labels":[null,"custom"],"__proto__":{"preserved":true}}') as Record<string, unknown> };
  const processor = createPlaneCreateProcessor(f.ports, {
    async create() { return retry ? { status: "unknown", error: { code: "TIMEOUT", custom: [null] } } : { status: "succeeded", item }; },
    async reconcile() { return { status: "found", item }; }
  }, { clock, idFactory: () => `history-${String(counter--).padStart(5, "0")}` });
  await processor.process(intent.id, "history-worker");
  if (retry) await processor.process(intent.id, "history-worker");
  const mapping = f.ports.externalWorkItems.listTicketMappings(f.ticket.id).find(value => value.externalContainerId === container.id)!;
  return { mapping, intent };
}

function update(mappingId: string, id: string, sequenceNumber: number, createdAt = clock().toISOString()) {
  const mapping = f.ports.externalWorkItems.findMappingById(mappingId)!;
  const payload = { ...planeExportPayload(f.revision), extra: JSON.parse('{"__proto__":{"keep":true},"values":[null,"原文"]}') as unknown };
  const intent: SyncIntent = { id, projectId: f.project.id, mappingId, externalContainerId: mapping.externalContainerId,
    sequenceNumber, operation: "update", sourceEventType: "ticket_revision.approved", sourceEventId: "approval",
    sourceTicketRevisionId: f.revision.id, payloadHash: hashJson(payload), payload, idempotencyKey: id,
    supersedesSyncIntentId: null, lifecycleStatus: "active", createdAt };
  f.ports.syncIntents.insert(intent);
  f.database.prepare("UPDATE external_work_item_mappings SET next_sequence_number = MAX(next_sequence_number, ?) WHERE id = ?")
    .run(sequenceNumber + 1, mappingId);
  return intent;
}

it("isolates mappings of the same owner and orders numeric sequences ahead of creation time", async () => {
  const first = await exported("first");
  const second = await exported("second");
  update(first.mapping.id, "latest", 2, "2026-01-01");
  update(first.mapping.id, "earliest", 1, "2026-09-01");
  update(second.mapping.id, "other", 1);

  const history = f.service.listMappingSyncIntents(first.mapping.id);

  expect(history.intents.map(value => value.syncIntent.id)).toEqual(["earliest", "latest"]);
  expect(history.createRequest?.syncIntent).toEqual(first.intent);
  expect(history.createRequest?.attempts[0]?.externalWorkItemId).toBe(first.mapping.externalWorkItemId);
  expect(history.createRequest?.syncIntent.mappingId).toBeNull();
  expect(history.createRequest?.requestState).toBe("succeeded");
});

it("retains same-clock durable retry ordering even when IDs sort in the opposite order", async () => {
  const { mapping } = await exported("retry", true);

  const attempts = f.service.listMappingSyncIntents(mapping.id).createRequest!.attempts;

  expect(attempts.map(value => value.resultStatus)).toEqual(["failed", "succeeded"]);
  expect(attempts[0]!.startedAt).toBe(attempts[1]!.startedAt);
  expect(attempts[0]!.id > attempts[1]!.id).toBe(true);
  expect(attempts[0]!.error).toEqual({ code: "TIMEOUT", custom: [null] });
});

it("keeps archived owner, mapping, item, revision and intent history byte-equivalent after reopen", async () => {
  const { mapping, intent } = await exported("archive");
  update(mapping.id, "archived-update", 1);
  for (const table of ["projects", "tickets", "ticket_revisions", "external_work_items", "external_work_item_mappings", "sync_intents"]) {
    f.database.prepare(`UPDATE ${table} SET lifecycle_status = 'archived'`).run();
  }
  const expected = JSON.stringify(f.service.listMappingSyncIntents(mapping.id));
  expect(JSON.parse(expected).createRequest.syncIntent.id).toBe(intent.id);
  expect(JSON.parse(expected).intents[0].requestState).toBe("archived");
  const directory = mkdtempSync(join(tmpdir(), "mapping-history-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "history.sqlite");
  writeFileSync(path, f.database.serialize());
  const reopened = openDatabase(path);
  try {
    expect(JSON.stringify(new MappingSyncReads(createSqlitePorts(reopened)).get(mapping.id))).toBe(expected);
    expect(reopened.pragma("foreign_key_check")).toEqual([]);
  } finally { reopened.close(); }
});

it.each(["project", "container", "payload", "hash", "sequence", "operation", "attempt", "create-link", "success-proof", "missing-proof", "mapping-owner"])(
  "diagnoses invalid %s provenance instead of silently losing obligations", async field => {
    const first = await exported("first");
    const second = await exported("second");
    const intent = update(first.mapping.id, "mapped", 1);
    if (field === "project") {
      const project = f.service.createProject({ name: "Foreign project" }).project;
      f.database.prepare("UPDATE sync_intents SET project_id = ? WHERE id = ?").run(project.id, intent.id);
    } else if (field === "container") {
      f.database.prepare("UPDATE sync_intents SET external_container_id = ? WHERE id = ?").run(second.mapping.externalContainerId, intent.id);
    } else if (field === "payload") {
      const payload = { ...intent.payload, owner: { type: "ticket", id: "foreign-ticket" } };
      f.database.prepare("UPDATE sync_intents SET payload_json = ?, payload_hash = ? WHERE id = ?")
        .run(JSON.stringify(payload), hashJson(payload), intent.id);
    } else if (field === "hash") f.database.prepare("UPDATE sync_intents SET payload_hash = 'forged' WHERE id = ?").run(intent.id);
    else if (field === "sequence") f.database.prepare("UPDATE external_work_item_mappings SET next_sequence_number = 1 WHERE id = ?").run(first.mapping.id);
    else if (field === "operation") f.database.prepare("UPDATE sync_intents SET operation = 'delete' WHERE id = ?").run(intent.id);
    else if (field === "attempt") f.database.prepare("UPDATE sync_attempts SET idempotency_key = 'forged' WHERE sync_intent_id = ?").run(first.intent.id);
    else if (field === "create-link") f.database.prepare("UPDATE external_work_item_mappings SET metadata_json = ? WHERE id = ?")
      .run(JSON.stringify({ created_by_sync_intent_id: second.intent.id }), first.mapping.id);
    else if (field === "missing-proof") f.database.prepare("UPDATE external_work_item_mappings SET metadata_json = '{}' WHERE id = ?").run(first.mapping.id);
    else if (field === "success-proof") f.database.prepare("UPDATE sync_attempts SET response_json = '{}' WHERE sync_intent_id = ?").run(first.intent.id);
    else f.database.prepare("UPDATE external_work_item_mappings SET internal_owner_id = 'missing' WHERE id = ?").run(first.mapping.id);

    expect(() => f.service.listMappingSyncIntents(first.mapping.id)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(f.service.listMappingSyncIntents(second.mapping.id).intents).toEqual([]);
  }
);

it("reads a consistent snapshot while another connection commits an intent change", async () => {
  const { mapping } = await exported("snapshot");
  update(mapping.id, "mapped", 1);
  const directory = mkdtempSync(join(tmpdir(), "mapping-snapshot-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "history.sqlite");
  writeFileSync(path, f.database.serialize());
  const reader = openDatabase(path);
  reader.pragma("journal_mode = WAL");
  const writer = openDatabase(path);
  try {
    const ports = createSqlitePorts(reader);
    const list = ports.syncIntents.listByMappingId;
    ports.syncIntents.listByMappingId = id => {
      const intents = list(id);
      writer.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = 'mapped'").run();
      return intents;
    };

    expect(new MappingSyncReads(ports).get(mapping.id).intents[0]!.requestState).toBe("pending");
    expect(new MappingSyncReads(createSqlitePorts(reader)).get(mapping.id).intents[0]!.requestState).toBe("archived");
  } finally { writer.close(); reader.close(); }
});

it("exposes strict MCP input and complete snake-case history without changing durable records", async () => {
  const { mapping } = await exported("mcp");
  update(mapping.id, "mapped", 1);
  const before = f.database.serialize();
  const snapshot = domainSnapshot(f.database);
  const server = createMcpServer(f.service);
  const client = new Client({ name: "mapping-history", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const call = async (args: Record<string, unknown>) => client.callTool({ name: "list_mapping_sync_intents", arguments: args });
    const response = await call({ mapping_id: mapping.id });
    const envelope = JSON.parse((response.content as Array<{ text: string }>)[0]!.text) as ToolEnvelope;
    expect(envelope.data).toMatchObject({ mapping: { id: mapping.id }, create_request: {
      sync_intent: { mapping_id: null, sequence_number: null }, request_state: "succeeded"
    }, intents: [{ sync_intent: { id: "mapped", sequence_number: 1 }, attempts: [], request_state: "pending" }] });
    expect(envelope.audit_log_id).toBeUndefined();
    expect((await call({ mapping_id: mapping.id, project_id: "override" })).isError).toBe(true);
    expect((await call({ mapping_id: " " })).isError).toBe(true);
    const missing = await call({ mapping_id: "missing" });
    expect(JSON.parse((missing.content as Array<{ text: string }>)[0]!.text).error.code).toBe("NOT_FOUND");
    expect(domainSnapshot(f.database)).toEqual(snapshot);
    expect(f.database.serialize()).toEqual(before);
  } finally { await client.close(); await server.close(); }
});
