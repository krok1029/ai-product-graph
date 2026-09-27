import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { mappingTerminationReadFixture } from "../test-support/mapping-termination-read-fixture.js";
import { domainSnapshot } from "../test-support/domain-snapshot.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { SyncIntent } from "../domain/sync-intent.js";
import { hashJson } from "./plane-export-payload.js";
import { MappingSyncPlanReads } from "./mapping-sync-plan-reads.js";
import { MappingSyncReads } from "./mapping-sync-reads.js";
import { classifyMappingSyncObligations } from "./mapping-sync-obligations.js";
import { ProductGraphService } from "./product-graph-service.js";

let f: ReturnType<typeof mappingTerminationReadFixture>;
let target: MappingSyncPlanReads;
beforeEach(() => { f = mappingTerminationReadFixture(); target = new MappingSyncPlanReads(f.ports); });
afterEach(() => f.database.close());

it.each([
  ["unstarted", "ready", true, false], ["started", "waiting_for_attempt", false, true],
  ["failed", "retry_required", true, true], ["succeeded", "idle", false, false]
] as const)("observes the first %s obligation as %s", async (attemptState, state, candidate, blocker) => {
  const { mapping, create } = await f.exportMapping();
  const intent = f.mappedIntent(mapping, 1);
  if (attemptState !== "unstarted") f.attempt(mapping, intent, attemptState);

  const plan = target.get(mapping.id);

  expect(plan).toMatchObject({ mappingId: mapping.id, included: true, state,
    nextIntent: candidate ? { id: intent.id, sequenceNumber: 1, operation: "update", sourceTicketRevisionId: f.revision.id } : null,
    blockingIntentIds: blocker ? [intent.id] : [], terminationId: null });
  expect(plan.entries.map(entry => entry.id)).toEqual([create.id, intent.id]);
  expect(plan.entries[0]).toMatchObject({ sequenceNumber: null, disposition: "fulfilled", attemptState: "succeeded" });
  expect(plan.entries[1]).toMatchObject({ attemptState, disposition: attemptState === "succeeded" ? "fulfilled" : "required" });
});

it("skips an any-success obligation even when a later historical attempt failed", async () => {
  const { mapping } = await f.exportMapping();
  const first = f.mappedIntent(mapping, 1, "z-first");
  f.attempt(mapping, first, "succeeded", "a-success");
  f.attempt(mapping, first, "failed", "z-failure");
  const second = f.mappedIntent(mapping, 2, "a-second");

  const plan = target.get(mapping.id);

  expect(plan).toMatchObject({ state: "ready", nextIntent: { id: second.id } });
  expect(plan.entries[1]).toMatchObject({ id: first.id, disposition: "fulfilled", attemptState: "succeeded" });
});

it.each(["close", "reopen"] as const)("keeps failed %s ahead of newer content and status", async operation => {
  const { mapping } = await f.exportMapping();
  const first = lifecycle(mapping, 1, operation);
  f.attempt(mapping, first, "failed");
  f.mappedIntent(mapping, 2);
  lifecycle(mapping, 3, "reopen");

  const plan = target.get(mapping.id);

  expect(plan).toMatchObject({ state: "retry_required", nextIntent: { id: first.id, operation }, blockingIntentIds: [first.id] });
});

it("displaces failed old content without jumping over an earlier failed lifecycle", async () => {
  const { mapping } = await f.exportMapping();
  const old = f.mappedIntent(mapping, 1);
  f.attempt(mapping, old, "failed");
  const close = lifecycle(mapping, 2, "close");
  f.attempt(mapping, close, "failed");
  f.mappedIntent(mapping, 3);
  lifecycle(mapping, 4, "reopen");

  const plan = target.get(mapping.id);

  expect(plan).toMatchObject({ state: "retry_required", nextIntent: { id: close.id }, blockingIntentIds: [close.id] });
  expect(plan.entries[1]).toMatchObject({ id: old.id, disposition: "obsolete_failed_content", requestState: "failed" });
});

it.each(["started", "failed", "succeeded"] as const)("retains A supersession after B becomes %s and unrelated C arrives", async outcome => {
  const { mapping } = await f.exportMapping();
  const a = f.mappedIntent(mapping, 1);
  const b = f.mappedIntent(mapping, 2);
  supersede(b, a);
  f.attempt(mapping, b, outcome);
  const c = f.mappedIntent(mapping, 3);

  const plan = target.get(mapping.id);

  expect(plan.entries[1]).toMatchObject({ id: a.id, disposition: "superseded_unstarted", requestState: "pending" });
  expect(plan.state).toBe(outcome === "started" ? "waiting_for_attempt" : "ready");
  expect(plan.nextIntent?.id ?? null).toBe(outcome === "started" ? null : c.id);
  expect(plan.blockingIntentIds).toEqual(outcome === "started" ? [b.id] : []);
  const classified = classifyMappingSyncObligations({ ...new MappingSyncReads(f.ports).get(mapping.id), ticket: f.ticket });
  expect(plan.entries.map(entry => [entry.id, entry.disposition, entry.attemptState])).toEqual(
    classified.entries.map(entry => [entry.details.syncIntent.id, entry.disposition, entry.attemptState]));
  const health = f.service.getMappingSyncHealth(mapping.id);
  expect(health.requiredIntentIds).toEqual(plan.entries.filter(entry => ["required", "fulfilled"].includes(entry.disposition)).map(entry => entry.id));
  expect(health.ignoredContentIntentIds).toEqual(plan.entries.filter(entry =>
    ["superseded_unstarted", "obsolete_failed_content"].includes(entry.disposition)).map(entry => entry.id));
  expect(health.syncHealth).toBe("pending");
});

it("reaches idle after C succeeds without resurrecting A or retrying failed B", async () => {
  const { mapping } = await f.exportMapping();
  const a = f.mappedIntent(mapping, 1);
  const b = f.mappedIntent(mapping, 2);
  supersede(b, a);
  f.attempt(mapping, b, "failed");
  const c = f.mappedIntent(mapping, 3);
  f.attempt(mapping, c, "succeeded");

  const plan = target.get(mapping.id);

  expect(plan).toMatchObject({ state: "idle", nextIntent: null, blockingIntentIds: [] });
  expect(plan.entries.map(entry => entry.disposition)).toEqual(["fulfilled", "superseded_unstarted", "obsolete_failed_content", "fulfilled"]);
  expect(f.service.getMappingSyncHealth(mapping.id)).toMatchObject({ syncHealth: "current", ignoredContentIntentIds: [a.id, b.id] });
});

it("does not skip a supersession target that acquired a started attempt", async () => {
  const { mapping } = await f.exportMapping();
  const a = f.mappedIntent(mapping, 1);
  const b = f.mappedIntent(mapping, 2);
  supersede(b, a);
  f.attempt(mapping, a, "started");

  expect(target.get(mapping.id)).toMatchObject({ state: "waiting_for_attempt", nextIntent: null, blockingIntentIds: [a.id] });
});

it.each(["gap", "missing-create", "missing-snapshot", "broken-pointer", "invalid-revision", "missing-content", "missing-close", "missing-reopen"])(
  "offers no candidate for %s history", async damage => {
    const { mapping } = await f.exportMapping();
    const first = f.mappedIntent(mapping, 1);
    if (damage === "gap") f.database.prepare("UPDATE external_work_item_mappings SET next_sequence_number = 3 WHERE id = ?").run(mapping.id);
    if (damage === "missing-create") f.database.prepare("UPDATE external_work_item_mappings SET metadata_json = '{}' WHERE id = ?").run(mapping.id);
    if (damage === "missing-snapshot") f.database.prepare("UPDATE sync_attempts SET response_json = '{}' WHERE external_work_item_id = ?").run(mapping.externalWorkItemId);
    if (damage === "broken-pointer") supersede(first, first);
    if (damage === "invalid-revision") f.database.prepare("UPDATE tickets SET current_approved_revision_id = NULL WHERE id = ?").run(f.ticket.id);
    if (damage === "missing-content") {
      const approved = replaceRevision();
      f.database.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = ?").run(approved.createdSyncIntentIds[0]!);
      // 保留完整 sequence，但模擬 current revision 的 content 義務遺漏。
      const original = f.ports.syncIntents.findById(first.id)!;
      f.database.prepare("UPDATE sync_intents SET source_ticket_revision_id = ?, payload_json = ?, payload_hash = ? WHERE id = ?")
        .run(original.sourceTicketRevisionId, JSON.stringify(original.payload), original.payloadHash, approved.createdSyncIntentIds[0]!);
    }
    if (damage === "missing-close") f.database.prepare("UPDATE tickets SET delivery_status = 'done' WHERE id = ?").run(f.ticket.id);
    if (damage === "missing-reopen") lifecycle(mapping, 2, "close");

    const plan = target.get(mapping.id);

    expect(plan).toMatchObject({ state: "invalid_history", nextIntent: null, blockingIntentIds: [] });
    expect(plan.reasons.length).toBeGreaterThan(0);
  }
);

it("retains active work for archived external items and never infers termination from generic archive", async () => {
  const { mapping } = await f.exportMapping();
  const intent = f.mappedIntent(mapping, 1);
  f.database.prepare("UPDATE external_work_items SET lifecycle_status = 'archived' WHERE id = ?").run(mapping.externalWorkItemId);
  expect(target.get(mapping.id)).toMatchObject({ included: true, state: "ready", nextIntent: { id: intent.id } });

  f.database.prepare("UPDATE external_work_item_mappings SET lifecycle_status = 'archived', metadata_json = '{}' WHERE id = ?").run(mapping.id);

  expect(target.get(mapping.id)).toMatchObject({ included: false, state: "inactive", nextIntent: null, terminationId: null,
    reasons: [{ code: "mapping_archived" }, { code: "incomplete_history" }] });
});

it("references only a validated termination and preserves its stopped attempt outcome", async () => {
  const { mapping } = await f.exportMapping();
  const intent = f.mappedIntent(mapping, 1);
  f.attempt(mapping, intent, "failed");
  const stopped = f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "Provider retired" });
  const before = domainSnapshot(f.database);

  const plan = target.get(mapping.id);

  expect(plan).toMatchObject({ included: false, state: "inactive", nextIntent: null, terminationId: stopped.termination.id });
  expect(domainSnapshot(f.database)).toEqual(before);
  expect(f.service.getSyncIntent(intent.id).requestState).toBe("failed");
});

it("does not expose a damaged termination as a valid reference", async () => {
  const { mapping } = await f.exportMapping();
  const stopped = f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" });
  f.database.exec("DROP TRIGGER terminated_mapping_decisions_no_update");
  f.database.prepare("UPDATE decisions SET decision_type = 'acceptance_criterion_waiver' WHERE id = ?").run(stopped.decision.id);

  expect(target.get(mapping.id)).toMatchObject({ included: false, state: "inactive", nextIntent: null, terminationId: null,
    reasons: [{ code: "mapping_archived" }, { code: "incomplete_history" }] });
});

it.each(["active", "archived"] as const)("diagnoses malformed stored JSON on an %s mapping without offering work", async lifecycleStatus => {
  const { mapping } = await f.exportMapping();
  const intent = f.mappedIntent(mapping, 1);
  f.database.prepare("UPDATE sync_intents SET payload_json = '{' WHERE id = ?").run(intent.id);
  f.database.prepare("UPDATE external_work_item_mappings SET lifecycle_status = ? WHERE id = ?").run(lifecycleStatus, mapping.id);

  const plan = target.get(mapping.id);

  expect(plan).toMatchObject({ state: lifecycleStatus === "active" ? "invalid_history" : "inactive",
    included: lifecycleStatus === "active", nextIntent: null, blockingIntentIds: [], terminationId: null });
  expect(plan.reasons).toContainEqual({ code: "incomplete_history" });
});

it("does not disguise unexpected storage errors as damaged history", async () => {
  const { mapping } = await f.exportMapping();
  const failure = new Error("Storage unavailable");
  f.ports.syncIntents.listByMappingId = () => { throw failure; };

  expect(() => target.get(mapping.id)).toThrow(failure);
});

it("distinguishes an unknown mapping from known damaged provenance", async () => {
  const { mapping } = await f.exportMapping();
  const foreign = f.service.createProject({ name: "Foreign" }).project;
  f.database.prepare("UPDATE external_work_item_mappings SET project_id = ? WHERE id = ?").run(foreign.id, mapping.id);

  expect(target.get(mapping.id)).toMatchObject({ state: "invalid_history", nextIntent: null });
  expect(() => target.get("missing")).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
});

it("reads without a clock, IDs, lease expiry, or writes to any durable table", async () => {
  const { mapping } = await f.exportMapping();
  f.attempt(mapping, f.mappedIntent(mapping, 1), "started");
  const service = new ProductGraphService(f.ports, { clock: () => { throw new Error("Unexpected clock"); },
    idFactory: () => { throw new Error("Unexpected ID"); } });
  const before = { data: domainSnapshot(f.database), changes: f.database.prepare("SELECT total_changes() AS count").get(),
    audit: f.database.prepare("SELECT * FROM audit_log").all(), actors: f.database.prepare("SELECT * FROM local_actors").all() };

  const plan = service.getMappingSyncPlan(mapping.id);

  expect(plan.state).toBe("waiting_for_attempt");
  expect(service.getMappingSyncPlan(mapping.id)).toEqual(plan);
  expect({ data: domainSnapshot(f.database), changes: f.database.prepare("SELECT total_changes() AS count").get(),
    audit: f.database.prepare("SELECT * FROM audit_log").all(), actors: f.database.prepare("SELECT * FROM local_actors").all() }).toEqual(before);
});

it("keeps Ticket state on one snapshot when another connection commits after the mapping read", async () => {
  const { mapping } = await f.exportMapping();
  const intent = f.mappedIntent(mapping, 1);
  const directory = mkdtempSync(join(tmpdir(), "mapping-plan-snapshot-"));
  const path = join(directory, "project.sqlite");
  writeFileSync(path, f.database.serialize());
  const reader = openDatabase(path);
  reader.pragma("journal_mode = WAL");
  const writer = openDatabase(path);
  try {
    const ports = createSqlitePorts(reader);
    const find = ports.externalWorkItems.findMappingById;
    let changed = false;
    ports.externalWorkItems.findMappingById = id => {
      const value = find(id);
      if (!changed) {
        changed = true;
        writer.prepare("UPDATE tickets SET delivery_status = 'done' WHERE id = ?").run(f.ticket.id);
      }
      return value;
    };

    const plan = new MappingSyncPlanReads(ports).get(mapping.id);

    expect(plan).toMatchObject({ state: "ready", nextIntent: { id: intent.id } });
    const reopened = openDatabase(path);
    try { expect(new MappingSyncPlanReads(createSqlitePorts(reopened)).get(mapping.id)).toMatchObject({
      state: "invalid_history", nextIntent: null, reasons: [{ code: "missing_close_intent" }]
    }); } finally { reopened.close(); }
  } finally { writer.close(); reader.close(); rmSync(directory, { recursive: true, force: true }); }
});

function supersede(source: SyncIntent, previous: SyncIntent) {
  f.database.prepare("UPDATE sync_intents SET supersedes_sync_intent_id = ? WHERE id = ?").run(previous.id, source.id);
}

function lifecycle(mapping: ExternalWorkItemMapping, sequence: number, operation: "close" | "reopen") {
  const original = f.mappedIntent(mapping, sequence);
  const payload = { schema_version: 1, owner: { type: "ticket", id: f.ticket.id },
    source_ticket_revision_id: f.revision.id, delivery_status: operation === "close" ? "done" : "planned" };
  f.database.prepare("UPDATE sync_intents SET operation = ?, payload_json = ?, payload_hash = ? WHERE id = ?")
    .run(operation, JSON.stringify(payload), hashJson(payload), original.id);
  return f.ports.syncIntents.findById(original.id)!;
}

function replaceRevision() {
  const revision = f.ports.ticketRevisions.findById(f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!)!;
  const spec = revision.specification;
  const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: revision.id,
    sourceGraphRevisionId: revision.sourceGraphRevisionId, specification: { title: "Replacement", userStory: spec.user_story,
      scope: spec.scope, acceptanceCriteria: spec.acceptance_criteria.map(item => item.text), nonGoals: spec.non_goals,
      relatedGraphNodeIds: spec.related_graph_node_ids, implementationNotes: spec.implementation_notes,
      implementationTargets: revision.requiredTargets.map(value => ({ repositoryId: value.repository_id, scope: value.scope })) } });
  return f.service.approveTicketRevision(draft.revision.id);
}
