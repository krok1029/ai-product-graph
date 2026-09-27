import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { durablePlaneProvider } from "../test-support/durable-plane-provider.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { PlaneCreateProcessor } from "./plane-create-processor.js";
import type { PlaneProviderPort } from "./plane-provider-port.js";

let f: ReturnType<typeof acceptanceFixture>;
let provider: ReturnType<typeof durablePlaneProvider>;
let directory: string;
let now: number;
let intentId: string;
const clock = () => new Date(now);
const enrollment = { onCreated() {} };

beforeEach(() => {
  f = acceptanceFixture();
  directory = mkdtempSync(join(tmpdir(), "apg-plane-processor-"));
  provider = durablePlaneProvider(join(directory, "provider.sqlite"));
  now = Date.UTC(2026, 8, 27, 1);
  intentId = request();
});
afterEach(() => { provider.close(); f.database.close(); rmSync(directory, { recursive: true, force: true }); });

it("atomically saves success, mapping, snapshot and graph trace without altering product decisions", async () => {
  const project = f.ports.projects.findById(f.project.id);
  const ticket = f.ports.tickets.findById(f.ticket.id);
  const intent = f.ports.syncIntents.findById(intentId);
  let hookCalls = 0;
  const target = new PlaneCreateProcessor(f.ports, {
    ...provider.port, async create(input) {
      expect(f.database.inTransaction).toBe(false);
      return provider.port.create(input);
    }
  }, { onCreated() { expect(f.database.inTransaction).toBe(true); hookCalls++; } }, { clock });

  const result = await target.process(intentId, "worker");

  expect(result.status).toBe("succeeded");
  expect(hookCalls).toBe(1);
  const details = f.service.listTicketExternalWorkItems(f.ticket.id).items[0]!;
  expect(details.mapping).toMatchObject({ sourceTicketRevisionId: f.revision.id, lifecycleStatus: "active" });
  expect(details.snapshots).toHaveLength(1);
  expect(details.snapshots[0]).toMatchObject({ concurrencyToken: "version-1", externalStatus: "backlog",
    content: { labels: ["external-only"], title: f.revision.title } });
  expect(f.ports.graphNodes.findById(result.externalWorkItemId!)!).toMatchObject({ type: "external_work_item",
    createdInGraphRevisionId: null, sourceRefId: result.externalWorkItemId });
  expect(f.ports.graphEdges.list(f.project.id, "active")).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceNodeId: result.externalWorkItemId, targetNodeId: f.ticket.id, relationType: "traces_to" })
  ]));
  expect(f.ports.projects.findById(f.project.id)).toEqual(project);
  expect(f.ports.tickets.findById(f.ticket.id)).toEqual(ticket);
  expect(f.ports.syncIntents.findById(intentId)).toEqual(intent);
  expect(f.database.pragma("foreign_key_check")).toEqual([]);
  expect((await target.process(intentId, "worker")).status).toBe("already_succeeded");
  expect(provider.calls()).toEqual([{ operation: "create" }]);
});

it("keeps external graph traces owner-scoped and durable without widening product provenance", async () => {
  const target = new PlaneCreateProcessor(f.ports, provider.port, enrollment, { clock });
  const result = await target.process(intentId, "worker");
  const edge = f.ports.graphEdges.list(f.project.id, "active").find(value => value.sourceNodeId === result.externalWorkItemId)!;
  f.ports.tickets.insert({ ...f.ticket, id: "another-owner", slug: "another-owner", currentApprovedRevisionId: null });
  expect(() => f.ports.graphEdges.insert({ ...edge, id: "wrong-owner-edge", targetNodeId: "another-owner" })).toThrow();
  expect(() => f.ports.graphEdges.insert({ ...edge, id: "wrong-relation-edge", relationType: "supports" })).toThrow();
  const node = f.ports.graphNodes.findById(result.externalWorkItemId!)!;
  expect(() => f.ports.graphNodes.insert({ ...node, id: "fake-product-node", slug: "fake-product-node", type: "feature_area" })).toThrow();
  const path = join(directory, "graph.sqlite");
  await f.database.backup(path);
  const reopened = openDatabase(path);
  try {
    const ports = createSqlitePorts(reopened);
    expect(ports.graphNodes.findById(node.id)).toEqual(node);
    expect(ports.graphEdges.list(f.project.id, "active")).toContainEqual(edge);
    expect(reopened.pragma("foreign_key_check")).toEqual([]);
  } finally { reopened.close(); }
});

it("reconciles an external success after local audit rollback and process restart", async () => {
  f.database.exec(`CREATE TRIGGER reject_export_commit BEFORE INSERT ON audit_log
    WHEN NEW.action = 'plane_ticket_export.completed' BEGIN SELECT RAISE(ABORT, 'reject commit'); END`);
  const target = new PlaneCreateProcessor(f.ports, provider.port, enrollment, { clock });
  await expect(target.process(intentId, "first", 1000)).rejects.toThrow();
  expect(provider.count()).toBe(1);
  expect(count("external_work_items")).toBe(0);
  expect(f.service.getSyncIntent(intentId).requestState).toBe("running");
  f.database.exec("DROP TRIGGER reject_export_commit");
  const path = join(directory, "local.sqlite");
  await f.database.backup(path);
  now += 1001;
  provider.close();
  provider = durablePlaneProvider(join(directory, "provider.sqlite"));
  const reopened = openDatabase(path);
  try {
    const ports = createSqlitePorts(reopened);
    const next = new PlaneCreateProcessor(ports, provider.port, enrollment, { clock });
    expect((await next.process(intentId, "restarted")).status).toBe("succeeded");
    expect(provider.calls()).toEqual([{ operation: "create" }, { operation: "reconcile" }]);
    expect(ports.syncIntents.listAttempts(intentId).map(attempt => attempt.resultStatus)).toEqual(["failed", "succeeded"]);
    expect(ports.externalWorkItems.listTicketMappings(f.ticket.id)).toHaveLength(1);
    expect(reopened.pragma("foreign_key_check")).toEqual([]);
  } finally { reopened.close(); }
});

it("reconciles timeout after remote commit without recreating the item", async () => {
  const target = new PlaneCreateProcessor(f.ports, { ...provider.port, async create(input) {
    await provider.port.create(input);
    throw new Error("Transport lost response");
  } }, enrollment, { clock });
  expect((await target.process(intentId, "first")).status).toBe("failed");
  expect((await target.process(intentId, "retry")).status).toBe("succeeded");
  expect(provider.count()).toBe(1);
  expect(provider.calls()).toEqual([{ operation: "create" }, { operation: "reconcile" }]);
  expect(f.service.getSyncIntent(intentId).attempts.map(attempt => attempt.resultStatus)).toEqual(["failed", "succeeded"]);
});

it("keeps unknown reconciliation failed until absence is proven, then uses a new attempt to create", async () => {
  let unknown = true;
  const port: PlaneProviderPort = {
    async create() { throw new Error("Connection uncertain before send"); },
    async reconcile(input) { return unknown ? { status: "unknown", error: { code: "CANNOT_PROVE_ABSENCE" } }
      : provider.port.reconcile(input); }
  };
  const target = new PlaneCreateProcessor(f.ports, port, enrollment, { clock });
  expect((await target.process(intentId, "first")).status).toBe("failed");
  expect((await target.process(intentId, "second")).status).toBe("failed");
  expect(provider.count()).toBe(0);
  unknown = false;
  expect((await target.process(intentId, "third")).status).toBe("reconciled_absent");
  const recovered = new PlaneCreateProcessor(f.ports, provider.port, enrollment, { clock });
  expect((await recovered.process(intentId, "fourth")).status).toBe("succeeded");
  expect(f.service.getSyncIntent(intentId).attempts).toHaveLength(4);
  expect(provider.calls()).toEqual([{ operation: "reconcile" }, { operation: "create" }]);
});

it("blocks a live competing worker and fences a late worker after lease takeover", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = new PlaneCreateProcessor(f.ports, { ...provider.port, async create(input) {
    const result = await provider.port.create(input); entered(); await gate; return result;
  } }, enrollment, { clock });
  const second = new PlaneCreateProcessor(f.ports, provider.port, enrollment, { clock });
  const pending = first.process(intentId, "old-worker", 1000);
  await started;
  await expect(second.process(intentId, "blocked-worker")).rejects.toMatchObject({ code: "CONFLICT" });
  now += 1001;
  expect((await second.process(intentId, "new-worker")).status).toBe("succeeded");
  release();
  await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
  expect(provider.count()).toBe(1);
  expect(count("external_work_item_mappings")).toBe(1);
});

it("isolates partial failures and retries only the failed target", async () => {
  const secondId = request("another-container");
  const target = new PlaneCreateProcessor(f.ports, { ...provider.port, async create(input) {
    if (input.container.containerIdentity === "another-container") return { status: "failed", error: { code: "DENIED" } };
    return provider.port.create(input);
  } }, enrollment, { clock });
  expect((await target.process(intentId, "one")).status).toBe("succeeded");
  expect((await target.process(secondId, "two")).status).toBe("failed");
  expect((await target.process(intentId, "duplicate")).status).toBe("already_succeeded");
  expect(provider.count()).toBe(1);
  expect(f.ports.tickets.findById(f.ticket.id)).toMatchObject({ deliveryStatus: "planned" });
});

it("retains uncertainty for malformed success observations instead of creating a local projection", async () => {
  const target = new PlaneCreateProcessor(f.ports, { ...provider.port, async create() {
    return { status: "succeeded", item: { externalId: " ", externalUrl: null, content: {},
      externalStatus: null, concurrencyToken: null } };
  } }, enrollment, { clock });
  expect((await target.process(intentId, "worker")).status).toBe("failed");
  expect(count("external_work_items")).toBe(0);
  expect(f.service.getSyncIntent(intentId).attempts[0]!.error).toEqual({ code: "INVALID_PROVIDER_OBSERVATION" });
  expect((await target.process(intentId, "retry")).status).toBe("reconciled_absent");
});

it("rolls back all success records when enrollment fails and reconciles on recovery", async () => {
  const target = new PlaneCreateProcessor(f.ports, provider.port, { onCreated() { throw new Error("Enrollment failed"); } }, { clock });
  await expect(target.process(intentId, "first", 1000)).rejects.toThrow("Enrollment failed");
  expect(count("external_work_items")).toBe(0);
  expect(count("external_work_item_mappings")).toBe(0);
  expect(count("external_work_item_snapshots")).toBe(0);
  expect(f.ports.graphNodes.list(f.project.id, "active").filter(node => node.type === "external_work_item")).toEqual([]);
  now += 1001;
  const recovered = new PlaneCreateProcessor(f.ports, provider.port, enrollment, { clock });
  expect((await recovered.process(intentId, "retry")).status).toBe("succeeded");
  expect(provider.count()).toBe(1);
});

it("rejects archived and malformed intents without invoking the provider", async () => {
  const target = new PlaneCreateProcessor(f.ports, provider.port, enrollment, { clock });
  await expect(target.process("unknown", "worker")).rejects.toMatchObject({ code: "NOT_FOUND" });
  f.database.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = ?").run(intentId);
  await expect(target.process(intentId, "worker")).rejects.toMatchObject({ code: "CONFLICT" });
  f.database.prepare("UPDATE sync_intents SET lifecycle_status = 'active', payload_hash = 'invalid' WHERE id = ?").run(intentId);
  await expect(target.process(intentId, "worker")).rejects.toMatchObject({ code: "CONFLICT" });
  expect(provider.calls()).toEqual([]);
  expect(f.service.getSyncIntent(intentId).attempts).toEqual([]);
});

function request(containerIdentity = "default-container") {
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity }).externalContainer;
  return f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: containerIdentity }).syncIntent.id;
}
function count(table: string) { return (f.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count; }
