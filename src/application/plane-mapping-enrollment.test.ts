import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { PlaneMappingEnrollment } from "./plane-mapping-enrollment.js";
import { hashJson, planeExportPayload } from "./plane-export-payload.js";
import { ProductGraphService } from "./product-graph-service.js";

let f: ReturnType<typeof acceptanceFixture>;
beforeEach(() => { f = acceptanceFixture(); });
afterEach(() => { f.database.close(); });

it("keeps first export manual and does not manufacture events for unchanged delivery status", () => {
  const replacement = approveReplacement();
  expect(replacement.createdSyncIntentIds).toEqual([]);
  expect(allIntents()).toEqual([]);
  const enrollment = new PlaneMappingEnrollment(f.ports, ulid);
  f.ports.transactions.run(() => enrollment.onDeliveryChanged(f.ticket, "planned", "unused", "now"));
  expect(allIntents()).toEqual([]);
});

it("pins an independent update and monotonic sequence for each active Plane mapping", () => {
  const first = mapping("first");
  const second = mapping("second");
  mapping("archived", "archived");
  const archivedItem = mapping("archived-item");
  f.database.prepare("UPDATE external_work_items SET lifecycle_status = 'archived' WHERE id = ?").run(archivedItem.externalWorkItemId);
  const approved = approveReplacement();
  const intents = allIntents();
  expect(intents).toHaveLength(3);
  expect(new Set(intents.map(intent => intent.mappingId))).toEqual(new Set([first.id, second.id, archivedItem.id]));
  expect(new Set(intents.map(intent => intent.idempotencyKey)).size).toBe(3);
  expect(new Set(approved.createdSyncIntentIds)).toEqual(new Set(intents.map(intent => intent.id)));
  for (const intent of intents) {
    expect(intent).toMatchObject({ operation: "update", sequenceNumber: 1, sourceTicketRevisionId: approved.revision.id,
      sourceEventType: "ticket_revision.approved", sourceEventId: approved.auditLogId, supersedesSyncIntentId: null });
    expect(intent.payload).toEqual(planeExportPayload(approved.revision));
    expect(intent.payloadHash).toBe(hashJson(intent.payload));
    expect(f.service.getSyncIntent(intent.id).requestState).toBe("pending");
    expect(f.ports.syncIntents.listAttempts(intent.id)).toEqual([]);
  }
  const newer = approveReplacement();
  expect(allIntents().filter(intent => intent.sourceTicketRevisionId === newer.revision.id).map(intent => intent.sequenceNumber)).toEqual([2, 2, 2]);
  for (const intent of allIntents().filter(intent => intent.sourceTicketRevisionId === newer.revision.id)) {
    expect(intent.supersedesSyncIntentId).toBe(intents.find(previous => previous.mappingId === intent.mappingId)!.id);
  }
});

it("queues close/reopen exactly once across receipt replay even when the active mapping item is archived", () => {
  const first = mapping("first");
  const archivedItem = mapping("archived-item");
  mapping("archived-mapping", "archived");
  f.database.prepare("UPDATE external_work_items SET lifecycle_status = 'archived' WHERE id = ?").run(archivedItem.externalWorkItemId);
  const result = f.submit().implementationResult;
  const input = { implementationResultId: result.id, idempotencyKey: "accept" };
  const accepted = f.service.acceptImplementationResult(input);
  expect(allIntents().map(intent => [intent.operation, intent.sequenceNumber])).toEqual([["close", 1], ["close", 1]]);
  expect(f.service.acceptImplementationResult(input)).toEqual(accepted);
  expect(allIntents()).toHaveLength(2);
  const acceptance = accepted.data.result_acceptance as { id: string };
  const revokeInput = { resultAcceptanceId: acceptance.id, idempotencyKey: "revoke", reason: "Incorrect test", nextDeliveryStatus: "blocked" as const };
  const revoked = f.service.revokeResultAcceptance(revokeInput);
  expect(f.service.revokeResultAcceptance(revokeInput)).toEqual(revoked);
  const reopened = allIntents().filter(intent => intent.operation === "reopen");
  expect(reopened).toHaveLength(2);
  expect(new Set(allIntents().map(intent => intent.mappingId))).toEqual(new Set([first.id, archivedItem.id]));
  for (const intent of reopened) {
    expect(intent).toMatchObject({ sequenceNumber: 2, sourceEventType: "result_acceptance.revoked", sourceEventId: revoked.auditLogId });
    expect(intent.payload).toMatchObject({ delivery_status: "blocked", source_ticket_revision_id: f.revision.id });
  }
  expect(allIntents()).toHaveLength(4);
});

it("preserves close before replacement content and ordered reopen when approval resets done to planned", () => {
  mapping("first");
  const result = f.submit().implementationResult;
  f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept" });
  const approved = approveReplacement();
  const intents = allIntents();
  expect(intents.map(intent => [intent.operation, intent.sequenceNumber])).toEqual([["close", 1], ["update", 2], ["reopen", 3]]);
  expect(intents[2]).toMatchObject({ sourceEventId: approved.auditLogId, sourceTicketRevisionId: approved.revision.id });
  expect(intents[2]!.payload.delivery_status).toBe("planned");
  expect(f.ports.tickets.findById(f.ticket.id)!.deliveryStatus).toBe("planned");
});

it("does not enqueue close or reopen for partial target acceptance/revocation", () => {
  f.database.close(); f = acceptanceFixture(2);
  mapping("first");
  const result = f.submit().implementationResult;
  const accepted = f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept" });
  f.service.revokeResultAcceptance({ resultAcceptanceId: (accepted.data.result_acceptance as { id: string }).id,
    idempotencyKey: "revoke", reason: "Invalid partial acceptance" });
  expect(allIntents()).toEqual([]);
});

it("rolls back approval, artifacts, audit, actor and all mapping sequences when outbox fails", () => {
  mapping("first"); mapping("second");
  approveReplacement();
  const draft = replacementDraft();
  const service = new ProductGraphService(f.ports, { actor: { id: "new-reviewer", displayName: "New" } });
  const before = dump();
  f.database.exec("CREATE TRIGGER fail_enrollment BEFORE INSERT ON sync_intents BEGIN SELECT RAISE(ABORT, 'outbox failed'); END");
  expect(() => service.approveTicketRevision(draft.revision.id)).toThrow("outbox failed");
  expect(dump()).toEqual(before);
  f.database.exec("DROP TRIGGER fail_enrollment");
  expect(service.approveTicketRevision(draft.revision.id).createdSyncIntentIds).toHaveLength(2);
  const after = dump();
  expect(() => service.approveTicketRevision(draft.revision.id)).toThrow();
  expect(dump()).toEqual(after);
});

it.each(["accept", "revoke"])("rolls back %s decision/receipt and sequence when lifecycle outbox fails", operation => {
  mapping("first");
  const result = f.submit().implementationResult;
  const accept = () => f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept" });
  const acceptance = operation === "revoke" ? (accept().data.result_acceptance as { id: string }) : null;
  const invoke = operation === "accept" ? accept : () => f.service.revokeResultAcceptance({ resultAcceptanceId: acceptance!.id,
    idempotencyKey: "revoke", reason: "Invalid", nextDeliveryStatus: "in_progress" });
  const before = dump();
  f.database.exec("CREATE TRIGGER fail_enrollment BEFORE INSERT ON sync_intents BEGIN SELECT RAISE(ABORT, 'outbox failed'); END");
  expect(invoke).toThrow("outbox failed");
  expect(dump()).toEqual(before);
  f.database.exec("DROP TRIGGER fail_enrollment");
  invoke();
  expect(allIntents().at(-1)!.operation).toBe(operation === "accept" ? "close" : "reopen");
});

it("replays a source event without allocating extra sequences or duplicating intents", () => {
  mapping("first");
  const approved = approveReplacement();
  const before = dump();
  const enrollment = new PlaneMappingEnrollment(f.ports, ulid);
  expect(f.ports.transactions.run(() => enrollment.onRevisionApproved(f.ticket, approved.revision, approved.auditLogId, approved.revision.approvedAt!)))
    .toEqual(approved.createdSyncIntentIds);
  expect(dump()).toEqual(before);
});

it("keeps revocation available after revision archival and pins the historical status source", () => {
  mapping("first");
  const result = f.submit().implementationResult;
  const accepted = f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept" });
  f.database.prepare("UPDATE ticket_revisions SET lifecycle_status = 'archived' WHERE id = ?").run(f.revision.id);
  f.service.revokeResultAcceptance({ resultAcceptanceId: (accepted.data.result_acceptance as { id: string }).id,
    idempotencyKey: "revoke", reason: "Invalid", nextDeliveryStatus: "blocked" });
  expect(allIntents().at(-1)).toMatchObject({ operation: "reopen", sourceTicketRevisionId: f.revision.id });
});

it("guards sequence allocation transaction boundaries and duplicate sequence insertion", () => {
  const enrolled = mapping("first");
  expect(() => f.ports.planeEnrollment.allocateSequence(enrolled.id, "now")).toThrow("requires a transaction");
  approveReplacement();
  const intent = allIntents()[0]!;
  expect(() => f.ports.syncIntents.insert({ ...intent, id: ulid(), idempotencyKey: "other" })).toThrow(/UNIQUE/);
});

it("persists pending outbox and resumes sequences after database reopen", async () => {
  const enrolled = mapping("first");
  approveReplacement();
  approveReplacement();
  const original = allIntents();
  const directory = mkdtempSync(join(tmpdir(), "plane-enrollment-"));
  try {
    const file = join(directory, "graph.db");
    await f.database.backup(file);
    const database = openDatabase(file);
    try {
      const ports = createSqlitePorts(database);
      expect(ports.syncIntents.findById(original[0]!.id)).toEqual(original[0]);
      expect(ports.syncIntents.findById(original[1]!.id)!.supersedesSyncIntentId).toBe(original[0]!.id);
      expect(ports.transactions.run(() => ports.planeEnrollment.allocateSequence(enrolled.id, "now"))).toBe(3);
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally { database.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function mapping(name: string, lifecycleStatus = "active") {
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: name }).externalContainer;
  const itemId = ulid(); const mappingId = ulid();
  f.database.prepare(`INSERT INTO external_work_items(id, external_container_id, provider, external_id, lifecycle_status, created_at, updated_at)
    VALUES (?, ?, 'plane', ?, 'active', 'now', 'now')`).run(itemId, container.id, name);
  f.database.prepare(`INSERT INTO external_work_item_mappings(id, project_id, internal_owner_type, internal_owner_id,
    external_container_id, external_work_item_id, source_ticket_revision_id, lifecycle_status, created_at, updated_at)
    VALUES (?, ?, 'ticket', ?, ?, ?, ?, ?, 'now', 'now')`).run(mappingId, f.project.id, f.ticket.id, container.id, itemId, f.revision.id, lifecycleStatus);
  return f.ports.externalWorkItems.listTicketMappings(f.ticket.id).find(item => item.id === mappingId)!;
}
function replacementDraft() {
  return f.service.createTicketRevisionDraft({ ticketId: f.ticket.id,
    baseApprovedRevisionId: f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId,
    sourceGraphRevisionId: f.graph.graphRevision.id, specification: { title: "Updated feature", userStory: "Updated story",
      scope: ["Updated scope"], acceptanceCriteria: ["Updated criteria"], nonGoals: [], relatedGraphNodeIds: [f.goal],
      implementationTargets: f.revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope })), implementationNotes: [] } });
}
function approveReplacement() { return f.service.approveTicketRevision(replacementDraft().revision.id); }
function allIntents() {
  return (f.database.prepare("SELECT id FROM sync_intents ORDER BY created_at, sequence_number, id").all() as { id: string }[])
    .map(row => f.ports.syncIntents.findById(row.id)!);
}
function dump() {
  return Object.fromEntries(["tickets", "ticket_revisions", "implementation_briefs", "implementation_results", "result_acceptances",
    "result_revocations", "decisions", "local_actors", "audit_log", "operation_receipts", "sync_intents", "external_work_item_mappings"]
    .map(table => [table, f.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
