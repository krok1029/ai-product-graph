import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { SyncAttempt } from "../domain/sync-intent.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { createPlaneCreateProcessor } from "./create-plane-create-processor.js";
import { PlaneMappingEnrollment } from "./plane-mapping-enrollment.js";
import { ProductGraphService } from "./product-graph-service.js";

let f: ReturnType<typeof acceptanceFixture>;
beforeEach(() => { f = acceptanceFixture(); });
afterEach(() => { f.database.close(); });

it("persists A ← B ← C with unchanged old requests and current health after latest success and restart", async () => {
  const mapping = await exportMapping();
  const a = replaceRevision().createdSyncIntentIds[0]!;
  const beforeA = f.service.getSyncIntent(a);
  const b = replaceRevision().createdSyncIntentIds[0]!;
  const c = replaceRevision().createdSyncIntentIds[0]!;

  expect(f.service.getSyncIntent(a)).toEqual(beforeA);
  expect(f.service.getSyncIntent(b).syncIntent.supersedesSyncIntentId).toBe(a);
  expect(f.service.getSyncIntent(c).syncIntent.supersedesSyncIntentId).toBe(b);
  expect(f.service.getMappingSyncHealth(mapping.id)).toMatchObject({ syncHealth: "pending", ignoredContentIntentIds: [a, b] });
  recordAttempt(c, "succeeded");
  const health = f.service.getMappingSyncHealth(mapping.id);
  expect(health).toMatchObject({ syncHealth: "current", ignoredContentIntentIds: [a, b] });
  expect(f.service.getTicketSyncHealth(f.ticket.id).syncHealth).toBe("current");
  expect(f.service.listMappingSyncIntents(mapping.id).intents.map(details => details.requestState)).toEqual(["pending", "pending", "succeeded"]);

  const directory = mkdtempSync(join(tmpdir(), "content-supersession-"));
  try {
    const file = join(directory, "graph.db");
    await f.database.backup(file);
    const database = openDatabase(file);
    try {
      const target = new ProductGraphService(createSqlitePorts(database));
      expect(target.getMappingSyncHealth(mapping.id)).toEqual(health);
      expect(target.getSyncIntent(c).syncIntent.supersedesSyncIntentId).toBe(b);
      expect(target.getSyncIntent(a)).toEqual(beforeA);
    } finally { database.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.each(["started", "failed", "succeeded"] as const)("never revives A after B starts and becomes %s while C is approved", async outcome => {
  const mapping = await exportMapping();
  const a = replaceRevision().createdSyncIntentIds[0]!;
  const b = replaceRevision().createdSyncIntentIds[0]!;
  const attempt = recordAttempt(b, "started");
  const c = replaceRevision().createdSyncIntentIds[0]!;
  expect(f.service.getSyncIntent(c).syncIntent.supersedesSyncIntentId).toBeNull();
  if (outcome !== "started") {
    // Fixture 模擬 processor 完成同一次 attempt，正式流程尚未新增 mapped executor。
    f.database.prepare("UPDATE sync_attempts SET result_status = ?, completed_at = ? WHERE id = ?")
      .run(outcome, "2026-09-27T12:00:01.000Z", attempt);
  }
  recordAttempt(c, "succeeded");

  const health = f.service.getMappingSyncHealth(mapping.id);

  expect(health.ignoredContentIntentIds).toEqual(outcome === "failed" ? [a, b] : [a]);
  expect(health.syncHealth).toBe(outcome === "started" ? "pending" : "current");
  expect(f.service.getSyncIntent(a).requestState).toBe("pending");
});

it.each(["failed", "succeeded"] as const)("does not link past a %s predecessor", async outcome => {
  const mapping = await exportMapping();
  const a = replaceRevision().createdSyncIntentIds[0]!;
  recordAttempt(a, outcome);

  const approved = replaceRevision();
  const b = approved.createdSyncIntentIds[0]!;

  expect(f.service.getSyncIntent(b).syncIntent.supersedesSyncIntentId).toBeNull();
  expect(approved.syncHealth).toBe("pending");
  recordAttempt(b, "succeeded");
  expect(f.service.getMappingSyncHealth(mapping.id).syncHealth).toBe("current");
  expect(f.service.getSyncIntent(a).attempts[0]!.resultStatus).toBe(outcome);
});

it("does not cross a lifecycle barrier or reuse a stale mapping sequence across enqueue calls", async () => {
  const mapping = await exportMapping();
  const a = replaceRevision().createdSyncIntentIds[0]!;
  const ticket = f.ports.tickets.findById(f.ticket.id)!;
  const revision = f.ports.ticketRevisions.findById(ticket.currentApprovedRevisionId!)!;
  const enrollment = new PlaneMappingEnrollment(f.ports, ulid);
  const close = f.ports.transactions.run(() => enrollment.onDeliveryChanged(ticket, "done", "close-event", "2026-09-27T10:00:00.000Z"))[0]!;
  recordAttempt(close, "failed");
  // 模擬 done → planned 的核准；同一 mapping object 連續配置 update 與 reopen。
  const ids = f.ports.transactions.run(() => enrollment.onRevisionApproved({ ...ticket, deliveryStatus: "done" }, revision,
    "replacement-event", "2026-09-27T11:00:00.000Z"));

  expect(ids.map(id => f.service.getSyncIntent(id).syncIntent)).toMatchObject([
    { sequenceNumber: 3, operation: "update", supersedesSyncIntentId: null },
    { sequenceNumber: 4, operation: "reopen", supersedesSyncIntentId: null }
  ]);
  expect(f.service.getMappingSyncHealth(mapping.id)).toMatchObject({ syncHealth: "failed", ignoredContentIntentIds: [] });
  expect(f.service.getSyncIntent(a).requestState).toBe("pending");
});

it.each(["payload_hash", "revision_provenance", "null_payload"])("falls back to a null edge for invalid predecessor %s without rejecting approval", async damage => {
  await exportMapping();
  const a = replaceRevision().createdSyncIntentIds[0]!;
  if (damage === "payload_hash") f.database.prepare("UPDATE sync_intents SET payload_hash = 'damaged' WHERE id = ?").run(a);
  else if (damage === "null_payload") f.database.prepare("UPDATE sync_intents SET payload_json = 'null' WHERE id = ?").run(a);
  else {
    // Payload 自洽也不足以證明來源 revision 確實已核准。
    f.database.prepare("UPDATE ticket_revisions SET review_status = 'draft' WHERE id = ?")
      .run(f.ports.syncIntents.findById(a)!.sourceTicketRevisionId);
  }

  const approved = replaceRevision();

  expect(approved.revision.reviewStatus).toBe("approved");
  expect(f.service.getSyncIntent(approved.createdSyncIntentIds[0]!).syncIntent.supersedesSyncIntentId).toBeNull();
  expect(approved.syncHealth).toBe("pending");
});

async function exportMapping() {
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
  const intent = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: "manual" }).syncIntent;
  const observation = { externalId: "item", externalUrl: null, content: { name: "Observed" }, externalStatus: "open", concurrencyToken: "v1" };
  await createPlaneCreateProcessor(f.ports, {
    create: async () => ({ kind: "succeeded", item: observation }),
    reconcileCreate: async () => ({ kind: "found", item: observation })
  }).process(intent.id, "test");
  return f.ports.externalWorkItems.listTicketMappings(f.ticket.id)[0]!;
}
function replaceRevision() {
  const current = f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!;
  const revision = f.ports.ticketRevisions.findById(current)!;
  const spec = revision.specification;
  const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: current,
    sourceGraphRevisionId: revision.sourceGraphRevisionId, specification: { title: "Replacement", userStory: spec.user_story,
      scope: spec.scope, acceptanceCriteria: spec.acceptance_criteria.map(item => item.text), nonGoals: spec.non_goals,
      relatedGraphNodeIds: spec.related_graph_node_ids, implementationNotes: spec.implementation_notes,
      implementationTargets: revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope })) } });
  return f.service.approveTicketRevision(draft.revision.id);
}
function recordAttempt(intentId: string, outcome: SyncAttempt["resultStatus"]) {
  const intent = f.ports.syncIntents.findById(intentId)!;
  const mapping = f.ports.externalWorkItems.findMappingById(intent.mappingId!)!;
  const id = ulid();
  f.database.prepare(`INSERT INTO sync_attempts(id, sync_intent_id, external_work_item_id, operation, idempotency_key,
    started_at, completed_at, result_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, intent.id,
      mapping.externalWorkItemId, intent.operation, intent.idempotencyKey, "2026-09-27T12:00:00.000Z",
      outcome === "started" ? null : "2026-09-27T12:00:01.000Z", outcome);
  return id;
}
