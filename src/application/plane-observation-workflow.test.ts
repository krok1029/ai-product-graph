import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { domainSnapshot } from "../test-support/domain-snapshot.js";
import { createPlaneCreateProcessor } from "./create-plane-create-processor.js";
import type { PlaneManagedContentPort, PlaneObservationProviderPort, PlaneReadOutcome } from "./plane-observation-ports.js";
import type { PlaneItemObservation } from "./plane-provider-port.js";
import { PlaneObservationWorkflow } from "./plane-observation-workflow.js";

let f: ReturnType<typeof acceptanceFixture>;
let mappingId: string;
let item: PlaneItemObservation;
let key: string;
let provider: PlaneObservationProviderPort;
let target: PlaneObservationWorkflow;
let ticks: number;
const actor = { id: "observation-reader", displayName: "Reader" };
const comparator: PlaneManagedContentPort = {
  compare({ expected, observed }) {
    const title = (expected.payload.specification as { title: string }).title;
    const fields = { name: title, description_html: `<p>${title}</p>`, external_source: "ai-product-graph", external_id: expected.idempotencyKey };
    return (Object.entries(fields) as [keyof typeof fields, string][]).flatMap(([field, expected]) =>
      observed.content[field] === expected ? [] : [{ field, expected, observed: Object.hasOwn(observed.content, field) ?
        { present: true as const, value: observed.content[field] as string | null } : { present: false as const } }]);
  }
};
const clock = () => new Date(Date.UTC(2026, 8, 27, 2, 0, ticks++));

beforeEach(async () => {
  f = acceptanceFixture(); ticks = 0;
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
  const request = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: "original" }).syncIntent;
  key = request.idempotencyKey;
  item = { externalId: "plane-item", externalUrl: null, externalStatus: "opaque-state", concurrencyToken: null,
    content: { id: "plane-item", project: "project", name: f.revision.title, description_html: `<p>${f.revision.title}</p>`,
      external_source: "ai-product-graph", external_id: key, labels: ["external-only"] } };
  await createPlaneCreateProcessor(f.ports, { async create() { return { status: "succeeded", item }; },
    async reconcile() { return { status: "unknown", error: {} }; } }, { clock }).process(request.id, "creator");
  mappingId = f.ports.externalWorkItems.listTicketMappings(f.ticket.id)[0]!.id;
  provider = { readKnownItem: vi.fn(async () => {
    expect(f.database.inTransaction).toBe(false);
    return { status: "observed", item } as PlaneReadOutcome;
  }) };
  target = new PlaneObservationWorkflow(f.ports, provider, comparator, { actor, clock });
});
afterEach(() => f.database.close());

it("captures matching content with immutable provenance and distinct receipt/commit timestamps without advancing outbound baseline", async () => {
  // 已完成首次匯出，保存整個 domain 與 outbound health 作為比較基準。
  const before = domainSnapshot(f.database);
  const health = f.service.getMappingSyncHealth(mappingId);
  const original = f.ports.externalWorkItems.listMappingSnapshots(mappingId)[0]!;

  const result = await target.observe(mappingId);

  expect(result).toMatchObject({ status: "captured", mappingId, sourceTicketRevisionId: f.revision.id, contentDriftId: null });
  if (result.status !== "captured") throw new Error("capture expected");
  expect(f.database.prepare("SELECT * FROM plane_observations").all()).toEqual([{
    snapshot_id: result.snapshotId, project_id: f.project.id, mapping_id: mappingId,
    external_work_item_id: original.externalWorkItemId, ticket_id: f.ticket.id,
    source_ticket_revision_id: f.revision.id, actor_id: actor.id, audit_log_id: result.auditLogId
  }]);
  const snapshot = f.ports.externalWorkItems.listMappingSnapshots(mappingId).find(row => row.id === result.snapshotId)!;
  const audit = f.ports.auditLog.list().find(row => row.id === result.auditLogId)!;
  expect(snapshot).toMatchObject({ content: item.content, externalStatus: "opaque-state", concurrencyToken: null });
  expect(Date.parse(audit.createdAt) - Date.parse(snapshot.capturedAt)).toBe(1000);
  expect(audit).toMatchObject({ action: "plane_mapping.observed", entityType: "plane_observation", entityId: snapshot.id });
  expect(f.ports.externalWorkItems.listMappingSnapshots(mappingId)).toContainEqual(original);
  expect(f.service.getMappingSyncHealth(mappingId)).toEqual(health);
  const after = domainSnapshot(f.database);
  delete before.external_work_item_snapshots; delete before.plane_observations;
  delete after.external_work_item_snapshots; delete after.plane_observations;
  expect(after).toEqual(before);
  expect(f.database.pragma("foreign_key_check")).toEqual([]);
});

it("records managed marker drift with pinned revision while keeping external-only fields and canonical specification unchanged", async () => {
  item.content.external_id = null; delete item.content.external_source;
  const before = domainSnapshot(f.database);
  const health = f.service.getMappingSyncHealth(mappingId);

  const result = await target.observe(mappingId);

  expect(result.status).toBe("captured");
  const drift = f.database.prepare("SELECT * FROM content_drifts").get() as Record<string, unknown>;
  expect(JSON.parse(drift.diff_json as string)).toEqual({ schema_version: 1, source_ticket_revision_id: f.revision.id,
    changes: [{ field: "external_source", expected: "ai-product-graph", observed: { present: false } },
      { field: "external_id", expected: key, observed: { present: true, value: null } }] });
  expect(drift).toMatchObject({ mapping_id: mappingId, internal_owner_id: f.ticket.id, internal_owner_type: "ticket", resolution_decision_id: null });
  expect(f.service.getMappingSyncHealth(mappingId)).toEqual(health);
  const after = domainSnapshot(f.database);
  for (const table of ["external_work_item_snapshots", "plane_observations", "content_drifts"]) { delete before[table]; delete after[table]; }
  expect(after).toEqual(before);
});

it("pins the commit-time approved revision after a revision is approved during GET and retains original create marker", async () => {
  let revisionId = "";
  provider.readKnownItem = async () => {
    revisionId = replaceRevision();
    return { status: "observed", item };
  };

  const result = await target.observe(mappingId);

  expect(result).toMatchObject({ status: "captured", sourceTicketRevisionId: revisionId });
  const drift = f.database.prepare("SELECT diff_json FROM content_drifts").get() as { diff_json: string };
  expect(JSON.parse(drift.diff_json)).toEqual({ schema_version: 1, source_ticket_revision_id: revisionId,
    changes: [{ field: "name", expected: "New title", observed: { present: true, value: f.revision.title } },
      { field: "description_html", expected: "<p>New title</p>", observed: { present: true, value: `<p>${f.revision.title}</p>` } }] });
});

it("rejects termination during GET with no capture or actor side effects", async () => {
  let before: unknown;
  provider.readKnownItem = async () => {
    f.service.terminateSyncMapping({ mappingId, reason: "Stop observing" });
    before = allRows();
    return { status: "observed", item };
  };

  await expect(target.observe(mappingId)).rejects.toMatchObject({ code: "CONFLICT" });

  expect(allRows()).toEqual(before);
});

it("rejects changed container identity during GET without capture", async () => {
  let before: unknown;
  provider.readKnownItem = async () => {
    f.database.prepare("UPDATE external_containers SET workspace_identity = 'another' WHERE container_identity = 'project'").run();
    before = allRows();
    return { status: "observed", item };
  };
  await expect(target.observe(mappingId)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(allRows()).toEqual(before);
});

it("allows archived owner/item with an active mapping and ignores unrelated broken mapped payload history", async () => {
  replaceRevision();
  f.database.exec("UPDATE tickets SET lifecycle_status = 'archived'; UPDATE external_work_items SET lifecycle_status = 'archived'; UPDATE sync_intents SET payload_json = 'null' WHERE mapping_id IS NOT NULL");
  const result = await target.observe(mappingId);
  expect(result.status).toBe("captured");
  expect(f.ports.externalWorkItems.findMappingById(mappingId)!.lifecycleStatus).toBe("active");
});

it.each(["missing", "proof", "scope", "archived"])("rejects invalid %s provenance before provider access", async fault => {
  if (fault === "proof") f.database.exec("UPDATE sync_attempts SET response_json = '{}' WHERE result_status = 'succeeded'");
  if (fault === "scope") f.database.exec("UPDATE external_work_item_mappings SET internal_owner_type = 'implementation_target'");
  if (fault === "archived") f.database.exec("UPDATE external_work_item_mappings SET lifecycle_status = 'archived'");
  const before = allRows();
  await expect(target.observe(fault === "missing" ? "missing" : mappingId)).rejects.toMatchObject({ code: fault === "missing" ? "NOT_FOUND" : "CONFLICT" });
  expect(provider.readKnownItem).not.toHaveBeenCalled();
  expect(allRows()).toEqual(before);
});

it.each(["unknown", "throw", "identity", "project", "non-json", "managed-type", "null-outcome"])("does not write or expose secrets on provider %s", async fault => {
  provider.readKnownItem = async () => {
    if (fault === "unknown") return { status: "unknown", error: { code: "secret-api-key", http_status: 404 } };
    if (fault === "throw") throw new Error("secret-api-key https://secret");
    if (fault === "identity") item.externalId = "wrong";
    if (fault === "project") item.content.project = "wrong";
    if (fault === "non-json") item.content.bad = new Date();
    if (fault === "managed-type") item.content.name = 42;
    if (fault === "null-outcome") return null as unknown as PlaneReadOutcome;
    return { status: "observed", item };
  };
  const before = allRows();
  const result = await target.observe(mappingId);
  expect(result.status).toBe("unknown");
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(allRows()).toEqual(before);
});

it("preserves known sanitized HTTP rejection/status without storing an observation", async () => {
  provider.readKnownItem = async () => ({ status: "unknown", error: { code: "PLANE_HTTP_REJECTED", http_status: 404 } });
  expect(await target.observe(mappingId)).toEqual({ status: "unknown", error: { code: "PLANE_HTTP_REJECTED", http_status: 404 } });
  expect(f.database.prepare("SELECT * FROM plane_observations").all()).toEqual([]);
});

it.each(["audit_log", "external_work_item_snapshots", "plane_observations", "content_drifts"])("rolls back all capture writes on %s insertion failure", async table => {
  item.content.name = "Changed";
  f.database.exec(`CREATE TRIGGER reject_capture BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'capture rejected'); END`);
  const before = allRows();
  await expect(target.observe(mappingId)).rejects.toThrow("capture rejected");
  expect(allRows()).toEqual(before);
});

it.each(["unknown-field", "duplicate", "wrong-value", "throw"])("rolls back actor on invalid comparator %s", async fault => {
  const invalid: PlaneManagedContentPort = { compare() {
    if (fault === "throw") throw new Error("secret");
    const change = { field: "name", expected: "changed", observed: { present: true, value: item.content.name } };
    return (fault === "duplicate" ? [change, change] : fault === "unknown-field" ? [{ ...change, field: "labels" }] :
      [{ ...change, observed: { present: true, value: "wrong" } }]) as ReturnType<PlaneManagedContentPort["compare"]>;
  } };
  const before = allRows();
  const result = await new PlaneObservationWorkflow(f.ports, provider, invalid, { actor, clock }).observe(mappingId);
  expect(result).toEqual({ status: "unknown", error: { code: "INVALID_PLANE_RESPONSE" } });
  expect(allRows()).toEqual(before);
});

it("repeated identical reads remain distinct observations and do not resolve older drift", async () => {
  item.content.name = "Changed";
  const first = await target.observe(mappingId);
  const second = await target.observe(mappingId);
  item.content.name = f.revision.title;
  const third = await target.observe(mappingId);
  expect(new Set([first, second, third].map(row => row.status === "captured" && row.snapshotId)).size).toBe(3);
  expect(f.database.prepare("SELECT resolution_decision_id FROM content_drifts").all()).toEqual([
    { resolution_decision_id: null }, { resolution_decision_id: null }]);
});

it("protects provenance, snapshots and drift detection fields against updates and deletion", async () => {
  item.content.name = "Changed";
  await target.observe(mappingId);
  const before = allRows();
  for (const statement of ["UPDATE plane_observations SET actor_id = actor_id", "DELETE FROM plane_observations",
    "UPDATE external_work_item_snapshots SET content_json = '{}' WHERE id IN (SELECT snapshot_id FROM plane_observations)",
    "DELETE FROM external_work_item_snapshots WHERE id IN (SELECT snapshot_id FROM plane_observations)",
    "UPDATE content_drifts SET diff_json = '{}'", "DELETE FROM content_drifts"]) {
    expect(() => f.database.exec(statement)).toThrow(/immutable/);
  }
  expect(allRows()).toEqual(before);
});

it("survives database restart and preserves exact successful outbound proof", async () => {
  item.content.name = "Changed";
  const result = await target.observe(mappingId);
  const before = allRows();
  const directory = mkdtempSync(join(tmpdir(), "apg-observation-"));
  try {
    const path = join(directory, "database.sqlite");
    await f.database.backup(path);
    const reopened = openDatabase(path);
    try {
      expect(domainSnapshot(reopened)).toEqual(before.domain);
      const ports = createSqlitePorts(reopened);
      const again = await new PlaneObservationWorkflow(ports, provider, comparator, { actor, clock }).observe(mappingId);
      expect(again.status).toBe("captured");
      expect(again).not.toEqual(result);
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function allRows() {
  return { domain: domainSnapshot(f.database), audit: f.ports.auditLog.list(), actors: f.database.prepare("SELECT * FROM local_actors ORDER BY id").all() };
}
function replaceRevision() {
  const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
    sourceGraphRevisionId: f.graph.graphRevision.id,
    specification: { title: "New title", userStory: "New story", scope: ["Feature"], acceptanceCriteria: ["New criterion"],
      nonGoals: [], relatedGraphNodeIds: [f.goal], implementationTargets: f.revision.requiredTargets.map(value => ({
        repositoryId: value.repository_id, scope: value.scope })), implementationNotes: [] } });
  return f.service.approveTicketRevision(draft.revision.id).revision.id;
}

it("keeps done delivery state unchanged even when observed provider status differs", async () => {
  f.service.acceptImplementationResult({ implementationResultId: f.submit().implementationResult.id, idempotencyKey: "done" });
  const before = domainSnapshot(f.database);
  const result = await target.observe(mappingId);
  expect(result.status).toBe("captured");
  expect(f.ports.tickets.findById(f.ticket.id)!.deliveryStatus).toBe("done");
  const after = domainSnapshot(f.database);
  for (const table of ["external_work_item_snapshots", "plane_observations"]) { delete before[table]; delete after[table]; }
  expect(after).toEqual(before);
});

it("captures concurrent responses as independent history without overwriting item metadata", async () => {
  const persistedItem = f.ports.externalWorkItems.findById(f.ports.externalWorkItems.findMappingById(mappingId)!.externalWorkItemId);
  let release!: (outcome: PlaneReadOutcome) => void;
  let calls = 0;
  provider.readKnownItem = async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { release = resolve; });
    return { status: "observed", item: { ...item, concurrencyToken: "newer-token" } };
  };
  const first = target.observe(mappingId);
  const second = await target.observe(mappingId);
  release({ status: "observed", item: { ...item, concurrencyToken: "older-token" } });
  const last = await first;
  expect(second.status).toBe("captured");
  expect(last.status).toBe("captured");
  expect(f.ports.externalWorkItems.listMappingSnapshots(mappingId).map(row => row.concurrencyToken)).toEqual([
    null, "newer-token", "older-token"]);
  expect(f.ports.externalWorkItems.findById(persistedItem!.id)).toEqual(persistedItem);
});

it("does not allow a broken comparator to mutate the stored provider observation", async () => {
  const mutating: PlaneManagedContentPort = { compare({ observed }) { observed.content.name = "mutated"; return []; } };
  const result = await new PlaneObservationWorkflow(f.ports, provider, mutating, { actor, clock }).observe(mappingId);
  expect(result.status).toBe("captured");
  expect(f.ports.externalWorkItems.listMappingSnapshots(mappingId).at(-1)!.content).toEqual(item.content);
});

it("does not let provider request mutation weaken the persisted container identity check", async () => {
  provider.readKnownItem = async request => {
    request.container.containerIdentity = "wrong-project";
    return { status: "observed", item: { ...item, content: { ...item.content, project: "wrong-project" } } };
  };
  const before = allRows();
  expect((await target.observe(mappingId)).status).toBe("unknown");
  expect(allRows()).toEqual(before);
});
