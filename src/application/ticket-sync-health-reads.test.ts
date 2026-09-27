import { afterEach, beforeEach, expect, it } from "vitest";
import { ulid } from "ulid";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { createPlaneCreateProcessor } from "./create-plane-create-processor.js";
import { SyncAttemptClaims } from "./sync-attempt-claims.js";

let f: ReturnType<typeof acceptanceFixture>;
beforeEach(() => { f = acceptanceFixture(); });
afterEach(() => { f.database.close(); });

it("distinguishes an unenrolled Ticket from an outstanding manual export", () => {
  // 前置：container connection 本身沒有同步義務。
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
  expect(health()).toMatchObject({ syncHealth: "current", activeMappingCount: 0, outstandingExportCount: 0,
    reasons: [{ code: "not_enrolled" }] });

  // 操作：使用者明確要求建立外部項目。
  const intent = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: "manual" }).syncIntent;

  // 驗證：還沒有 mapping 時也正確呈現 pending／failed。
  expect(health()).toMatchObject({ syncHealth: "pending", activeMappingCount: 0, outstandingExportCount: 1,
    outstandingExports: [{ intentId: intent.id, syncHealth: "pending" }] });
  failCreate(intent.id);
  expect(health()).toMatchObject({ syncHealth: "failed", outstandingExportCount: 1,
    outstandingExports: [{ intentId: intent.id, syncHealth: "failed" }] });
});

it("aggregates a healthy mapping and a failed manual export without double-counting successful create", async () => {
  await exportMapping("healthy");
  const failed = request("failed");
  failCreate(failed.id);
  expect(health()).toMatchObject({ syncHealth: "failed", activeMappingCount: 1, outstandingExportCount: 1 });
  expect(health().mappings[0]).toMatchObject({ syncHealth: "current", included: true });
});

it("returns approved plus pending health after transactional revision enrollment", async () => {
  await exportMapping("mapped");
  const approved = replaceRevision();
  expect(approved.revision.reviewStatus).toBe("approved");
  expect(approved.syncHealth).toBe("pending");
  expect(approved.createdSyncIntentIds).toHaveLength(1);
  expect(health()).toMatchObject({ syncHealth: "pending", activeMappingCount: 1, outstandingExportCount: 0 });
});

it("keeps committed approval successful when an old lifecycle obligation has failed", async () => {
  await exportMapping("mapped");
  const accepted = f.service.acceptImplementationResult({ implementationResultId: f.submit().implementationResult.id, idempotencyKey: "accept" });
  failMappedIntent(mappedIntentIds(accepted.auditLogId)[0]!);

  const approved = replaceRevision();

  expect(approved.revision.reviewStatus).toBe("approved");
  expect(approved.syncHealth).toBe("failed");
  expect(approved.createdSyncIntentIds).toHaveLength(2);
  expect(health().syncHealth).toBe("failed");
});

it("counts archived items with active mappings and excludes only archived mappings", async () => {
  const first = await exportMapping("first");
  await exportMapping("second");
  const accepted = f.service.acceptImplementationResult({ implementationResultId: f.submit().implementationResult.id, idempotencyKey: "accept" });
  const firstClose = mappedIntentIds(accepted.auditLogId).find(id => f.ports.syncIntents.findById(id)!.mappingId === first.id)!;
  failMappedIntent(firstClose);
  f.database.prepare("UPDATE external_work_items SET lifecycle_status = 'archived' WHERE id = ?").run(first.externalWorkItemId);
  expect(health()).toMatchObject({ syncHealth: "failed", activeMappingCount: 2 });

  // 操作：明確以 fixture 模擬 mapping 已終止；歷史 failure 仍完整保存。
  f.database.prepare("UPDATE external_work_item_mappings SET lifecycle_status = 'archived' WHERE id = ?").run(first.id);

  expect(health()).toMatchObject({ syncHealth: "pending", activeMappingCount: 1 });
  expect(f.ports.syncIntents.listAttempts(firstClose).at(-1)!.resultStatus).toBe("failed");
});

it("preserves exact acceptance and revocation receipts while current health evolves", async () => {
  await exportMapping("mapped");
  const command = { implementationResultId: f.submit().implementationResult.id, idempotencyKey: "accept" };
  const accepted = f.service.acceptImplementationResult(command);
  failMappedIntent(mappedIntentIds(accepted.auditLogId)[0]!);
  expect(health().syncHealth).toBe("failed");
  expect(f.service.acceptImplementationResult(command)).toEqual(accepted);
  const revoke = { resultAcceptanceId: (accepted.data.result_acceptance as { id: string }).id, idempotencyKey: "revoke", reason: "Invalid original evidence", nextDeliveryStatus: "blocked" as const };
  const revoked = f.service.revokeResultAcceptance(revoke);
  expect(f.service.revokeResultAcceptance(revoke)).toEqual(revoked);
  expect(accepted.data).not.toHaveProperty("sync_health");
  expect(revoked.data).not.toHaveProperty("sync_health");
});

it("reports pending catch-up when desired content changes during create", async () => {
  const intent = request("in-flight");
  const processor = createPlaneCreateProcessor(f.ports, { async create() {
    replaceRevision();
    return { status: "succeeded", item: observation("in-flight") };
  }, async reconcile() { throw new Error("Not used"); } });
  await processor.process(intent.id, "test");
  expect(health()).toMatchObject({ syncHealth: "pending", activeMappingCount: 1, outstandingExportCount: 0 });
});

it("does not write audit, intents, attempts, actors or domain state during health reads", async () => {
  await exportMapping("mapped");
  const before = f.database.prepare("SELECT total_changes() AS count").get();
  const first = health();
  expect(health()).toEqual(first);
  expect(f.database.prepare("SELECT total_changes() AS count").get()).toEqual(before);
});

it("does not report current when a malformed obligation is hidden by ordinary scoped reads", async () => {
  const intent = request("invalid");
  const other = f.service.createProject({ name: "Other" }).project;
  f.database.prepare("UPDATE sync_intents SET project_id = ? WHERE id = ?").run(other.id, intent.id);
  expect(f.service.listTicketExportRequests(f.ticket.id).requests).toEqual([]);
  expect(health()).toMatchObject({ syncHealth: "pending", reasons: [{ code: "incomplete_history" }] });
});

it("does not hide a manual export whose operation no longer matches its source event", () => {
  const intent = request("invalid-operation");
  f.database.prepare("UPDATE sync_intents SET operation = 'update' WHERE id = ?").run(intent.id);
  expect(f.service.listTicketExportRequests(f.ticket.id).requests).toEqual([]);
  expect(health()).toMatchObject({ syncHealth: "pending", reasons: [{ code: "incomplete_history" }] });
});

it("does not silently exclude an invalid active mapping when its create request is archived", async () => {
  const mapping = await exportMapping("invalid-mapping");
  const other = f.service.createProject({ name: "Other" }).project;
  const createId = (mapping.metadata as { created_by_sync_intent_id: string }).created_by_sync_intent_id;
  f.database.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = ?").run(createId);
  f.database.prepare("UPDATE external_work_item_mappings SET project_id = ? WHERE id = ?").run(other.id, mapping.id);
  expect(f.ports.externalWorkItems.listTicketMappings(f.ticket.id)).toEqual([]);
  expect(health()).toMatchObject({ syncHealth: "pending", outstandingExportCount: 0,
    reasons: [{ code: "incomplete_history" }] });
});

it("keeps approval successful if a post-commit health read is temporarily unavailable", () => {
  const read = f.ports.externalWorkItems.hasInvalidTicketMappings;
  f.ports.externalWorkItems.hasInvalidTicketMappings = () => { throw new Error("temporary read failure"); };
  try {
    const approved = replaceRevision();
    expect(approved.revision.reviewStatus).toBe("approved");
    expect(approved.syncHealth).toBe("pending");
  } finally { f.ports.externalWorkItems.hasInvalidTicketMappings = read; }
});

function health() { return f.service.getTicketSyncHealth(f.ticket.id); }
function request(containerIdentity: string) {
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity }).externalContainer;
  const revision = f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!;
  return f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: revision,
    externalContainerId: container.id, idempotencyKey: containerIdentity }).syncIntent;
}
async function exportMapping(containerIdentity: string) {
  const intent = request(containerIdentity);
  await createPlaneCreateProcessor(f.ports, {
    async create() { return { status: "succeeded", item: observation(containerIdentity) }; },
    async reconcile() { throw new Error("Not used"); }
  }).process(intent.id, "test");
  return f.ports.externalWorkItems.listTicketMappings(f.ticket.id).find(mapping => mapping.externalContainerId === intent.externalContainerId)!;
}
function observation(id: string) {
  return { externalId: id, externalUrl: null, content: { name: "Observed" }, externalStatus: "open", concurrencyToken: "v1" };
}
function failCreate(intentId: string) {
  const claims = new SyncAttemptClaims(f.ports.syncClaims);
  const { claim } = claims.claim(intentId, "test", 60_000);
  claims.markInvoking(intentId, claim.token);
  claims.fail(intentId, claim.token, { code: "PROVIDER_FAILED" });
}
function failMappedIntent(intentId: string) {
  const intent = f.ports.syncIntents.findById(intentId)!;
  const itemId = f.ports.externalWorkItems.listTicketMappings(f.ticket.id).find(mapping => mapping.id === intent.mappingId)!.externalWorkItemId;
  // 尚未交付 lifecycle processor；fixture 保存其可讀的 terminal-failure history。
  f.database.prepare(`INSERT INTO sync_attempts (id, sync_intent_id, external_work_item_id, operation, idempotency_key,
    started_at, completed_at, result_status, error_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?)`)
    .run(ulid(), intentId, itemId, intent.operation, intent.idempotencyKey, "2026-09-27T12:00:00.000Z", "2026-09-27T12:00:01.000Z", '{"code":"FAILED"}');
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

function mappedIntentIds(auditLogId: string): string[] {
  return (f.database.prepare("SELECT id FROM sync_intents WHERE mapping_id IS NOT NULL AND source_event_id = ? ORDER BY id")
    .all(auditLogId) as { id: string }[]).map(row => row.id);
}
