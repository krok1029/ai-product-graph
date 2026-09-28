import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createPlaneCreateProcessor } from "../../application/create-plane-create-processor.js";
import { MappingSyncHealthReads } from "../../application/mapping-sync-health-reads.js";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";
import { createFullMcpServer as createMcpServer } from "../../test-support/full-mcp-server.js";
import type { ToolEnvelope } from "./tool-envelope.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const f = acceptanceFixture();
  cleanup.push(() => f.database.close());
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "plane-project" }).externalContainer;
  const request = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: "first-export" });
  let providerCalls = 0;
  await createPlaneCreateProcessor(f.ports, {
    create: async () => { providerCalls++; return { status: "succeeded", item: { externalId: "plane-item", externalUrl: null,
      content: { id: "plane-item", labels: ["external-only"] }, externalStatus: null, concurrencyToken: null } }; },
    reconcile: async () => { providerCalls++; return { status: "unknown", error: { code: "UNUSED" } }; }
  }).process(request.syncIntent.id, "health-fixture");
  const mapping = f.ports.externalWorkItems.listTicketMappings(f.ticket.id)[0]!;
  return { ...f, mapping, request, providerCalls: () => providerCalls };
}

async function clientFor(service: ProductGraphService) {
  const server = createMcpServer(service);
  const client = new Client({ name: "health-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return client;
}

async function call(client: Client, mappingId: string, extra: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: "get_mapping_sync_health", arguments: { mapping_id: mappingId, ...extra } });
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]!.text) as ToolEnvelope;
}

it("reads successful create health through strict MCP without durable or provider side effects", async () => {
  const f = await fixture();
  const client = await clientFor(f.service);
  const before = { domain: domainSnapshot(f.database), audit: f.ports.auditLog.list() };

  const result = await call(client, f.mapping.id);

  expect(result).toMatchObject({ ok: true, data: { sync_health: "current", included: true,
    required_intent_ids: [f.request.syncIntent.id], ignored_content_intent_ids: [], reasons: [{ code: "obligations_fulfilled" }] } });
  expect({ domain: domainSnapshot(f.database), audit: f.ports.auditLog.list() }).toEqual(before);
  expect(f.providerCalls()).toBe(1);
  await expect(call(client, f.mapping.id, { sync_health: "current" })).rejects.toThrow();
  expect(await call(client, "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
});

it("keeps an archived intent failure on an active mapping whose item and owner are archived", async () => {
  const f = await fixture();
  const submitted = f.submit().implementationResult;
  const accepted = f.service.acceptImplementationResult({ implementationResultId: submitted.id, idempotencyKey: "accept" });
  const close = f.ports.syncIntents.listByMappingId(f.mapping.id)[0]!;
  f.database.prepare(`INSERT INTO sync_attempts(id, sync_intent_id, operation, idempotency_key, started_at,
    completed_at, result_status, error_json) VALUES ('failed-close', ?, 'close', ?, ?, ?, 'failed', '{"code":"DENIED"}')`)
    .run(close.id, close.idempotencyKey, close.createdAt, close.createdAt);
  f.database.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = ?").run(close.id);
  f.database.prepare("UPDATE external_work_items SET lifecycle_status = 'archived' WHERE id = ?").run(f.mapping.externalWorkItemId);
  f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
  f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
  const before = domainSnapshot(f.database);

  expect(f.service.getMappingSyncHealth(f.mapping.id)).toMatchObject({ syncHealth: "failed", included: true,
    reasons: [{ code: "intent_failed", intentId: close.id }] });
  expect(f.service.acceptImplementationResult({ implementationResultId: submitted.id, idempotencyKey: "accept" })).toEqual(accepted);
  expect(domainSnapshot(f.database)).toEqual(before);
});

it("excludes archived mappings but preserves their history", async () => {
  const f = await fixture();
  f.database.prepare("UPDATE external_work_item_mappings SET lifecycle_status = 'archived' WHERE id = ?").run(f.mapping.id);
  expect(f.service.getMappingSyncHealth(f.mapping.id)).toEqual({ syncHealth: "current", included: false,
    requiredIntentIds: [], ignoredContentIntentIds: [], reasons: [{ code: "mapping_archived" }] });
  expect(f.service.listMappingSyncIntents(f.mapping.id).createRequest?.syncIntent.id).toBe(f.request.syncIntent.id);
});

it.each(["missing_create_proof", "invalid_hash", "invalid_mapping_identity"])(
  "diagnoses %s as pending while history reports corruption", async kind => {
    const f = await fixture();
    if (kind === "missing_create_proof") f.database.prepare("UPDATE sync_attempts SET response_json = '{}' WHERE sync_intent_id = ?").run(f.request.syncIntent.id);
    if (kind === "invalid_hash") f.database.prepare("UPDATE sync_intents SET payload_hash = 'corrupt' WHERE id = ?").run(f.request.syncIntent.id);
    if (kind === "invalid_mapping_identity") {
      const other = f.service.createProject({ name: "Other" }).project;
      f.database.prepare("UPDATE external_work_item_mappings SET project_id = ? WHERE id = ?").run(other.id, f.mapping.id);
    }
    const before = domainSnapshot(f.database);

    expect(f.service.getMappingSyncHealth(f.mapping.id)).toEqual({ syncHealth: "pending", included: true,
      requiredIntentIds: [], ignoredContentIntentIds: [], reasons: [{ code: "incomplete_history" }] });
    expect(() => f.service.listMappingSyncIntents(f.mapping.id)).toThrow();
    expect(domainSnapshot(f.database)).toEqual(before);
  });

it("reads Ticket and mapping history inside one transaction", async () => {
  const f = await fixture();
  const reads: boolean[] = [];
  const target = new MappingSyncHealthReads({ ...f.ports, tickets: { ...f.ports.tickets,
    findById(id) { reads.push(f.database.inTransaction); return f.ports.tickets.findById(id); } },
  syncIntents: { ...f.ports.syncIntents, listByMappingId(id) {
    reads.push(f.database.inTransaction); return f.ports.syncIntents.listByMappingId(id);
  } } });

  expect(target.get(f.mapping.id).syncHealth).toBe("current");
  expect(reads.length).toBeGreaterThanOrEqual(2);
  expect(reads.every(Boolean)).toBe(true);
  expect(f.database.inTransaction).toBe(false);
});

it("returns identical pending catch-up health and history after SQLite reopen", async () => {
  const f = await fixture();
  const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
    sourceGraphRevisionId: f.graph.graphRevision.id, specification: { title: "New feature", userStory: "New story",
      scope: ["New scope"], acceptanceCriteria: ["New criterion"], nonGoals: [], relatedGraphNodeIds: [f.goal],
      implementationTargets: f.revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope })), implementationNotes: [] } });
  const approved = f.service.approveTicketRevision(draft.revision.id);
  const original = f.service.getMappingSyncHealth(f.mapping.id);
  expect(original).toMatchObject({ syncHealth: "pending", requiredIntentIds: [f.request.syncIntent.id, ...approved.createdSyncIntentIds] });
  const directory = mkdtempSync(join(tmpdir(), "mapping-health-"));
  cleanup.push(() => rmSync(directory, { force: true, recursive: true }));
  const file = join(directory, "graph.db");
  await f.database.backup(file);
  const reopened = openDatabase(file);
  cleanup.push(() => reopened.close());
  const service = new ProductGraphService(createSqlitePorts(reopened));
  const client = await clientFor(service);
  const before = domainSnapshot(reopened);

  expect(service.getMappingSyncHealth(f.mapping.id)).toEqual(original);
  expect(await call(client, f.mapping.id)).toMatchObject({ ok: true, data: {
    sync_health: "pending", required_intent_ids: original.requiredIntentIds } });
  expect(domainSnapshot(reopened)).toEqual(before);
});
