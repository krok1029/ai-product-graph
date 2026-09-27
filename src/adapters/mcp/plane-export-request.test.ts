import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { canonicalizeJson } from "../../application/canonical-json.js";
import { hashJson } from "../../application/plane-export-payload.js";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createMcpServer } from "./server.js";

let f: ReturnType<typeof acceptanceFixture>;
let connection: Awaited<ReturnType<typeof connect>>;
let command: { ticket_id: string; source_ticket_revision_id: string; external_container_id: string; idempotency_key: string };

beforeEach(async () => {
  f = acceptanceFixture();
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
  command = { ticket_id: f.ticket.id, source_ticket_revision_id: f.revision.id,
    external_container_id: container.id, idempotency_key: " export-request " };
  connection = await connect(f.service);
});
afterEach(async () => { await connection.close(); f.database.close(); });

it("pins the approved projection in canonical durable storage without claiming external success", async () => {
  const ticketBefore = f.ports.tickets.findById(f.ticket.id);
  const projectBefore = f.ports.projects.findById(f.project.id);
  const response = await request();
  expect(response.isError).not.toBe(true);
  const envelope = response.structuredContent as { data: { sync_intent: { id: string } }; audit_log_id: string };
  const intent = f.ports.syncIntents.findById(envelope.data.sync_intent.id)!;
  expect(intent).toMatchObject({ operation: "create", mappingId: null, sequenceNumber: null,
    sourceEventType: "plane_ticket_export_requested", sourceEventId: envelope.audit_log_id,
    sourceTicketRevisionId: f.revision.id, lifecycleStatus: "active", supersedesSyncIntentId: null });
  expect(intent.payload).toMatchObject({ schema_version: 1, owner: { type: "ticket", id: f.ticket.id },
    source_ticket_revision_id: f.revision.id,
    specification: { title: f.revision.title, acceptance_criteria: f.revision.specification.acceptance_criteria } });
  expect(intent.payloadHash).toBe(hashJson(intent.payload));
  expect(f.database.prepare("SELECT payload_json FROM sync_intents WHERE id = ?").get(intent.id))
    .toEqual({ payload_json: canonicalizeJson(intent.payload) });
  expect(f.ports.tickets.findById(f.ticket.id)).toEqual(ticketBefore);
  expect(f.ports.projects.findById(f.project.id)).toEqual(projectBefore);
  for (const table of ["external_work_items", "external_work_item_mappings", "external_work_item_snapshots", "sync_attempts", "operation_receipts"]) {
    expect(count(table)).toBe(0);
  }
  expect(f.database.pragma("foreign_key_check")).toEqual([]);
});

it("replays the original intent and audit before lifecycle validation, and rejects changed commands", async () => {
  const original = await request();
  f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
  f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
  const changes = totalChanges();
  expect(await request({ idempotency_key: command.idempotency_key.trim() })).toEqual(original);
  expect(totalChanges()).toEqual(changes);
  expect(error(await request({ source_ticket_revision_id: "other-revision" }))).toBe("CONFLICT");
  expect(error(await request({ ticket_id: "missing-ticket" }))).toBe("NOT_FOUND");
  expect(count("sync_intents")).toBe(1);
});

it.each(["project", "ticket", "revision", "unknown-container", "foreign-revision", "draft-revision"])(
  "rejects %s source without saving intent or audit", async kind => {
    const overrides: Partial<typeof command> = {};
    if (kind === "project") f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
    if (kind === "ticket") f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
    if (kind === "revision") f.database.prepare("UPDATE ticket_revisions SET lifecycle_status = 'archived' WHERE id = ?").run(f.revision.id);
    if (kind === "unknown-container") overrides.external_container_id = "missing";
    if (kind === "foreign-revision") overrides.source_ticket_revision_id = anotherTicket().revision.id;
    if (kind === "draft-revision") {
      overrides.source_ticket_revision_id = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id,
        baseApprovedRevisionId: f.revision.id, sourceGraphRevisionId: f.graph.graphRevision.id,
        specification: specification() }).revision.id;
    }
    const changes = totalChanges();
    expect(error(await request(overrides))).toBe(kind === "unknown-container" ? "NOT_FOUND" : "CONFLICT");
    expect(totalChanges()).toEqual(changes);
    expect(count("sync_intents")).toBe(0);
  }
);

it.each(["archive", "replacement"])("rechecks Ticket after concurrent %s before entering the transaction", kind => {
  // 前置：在 identity lookup 與 transaction 之間模擬另一個 caller 已完成的變更。
  const target = new ProductGraphService({ ...f.ports, transactions: { run(operation) {
    if (kind === "archive") {
      f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
    } else {
      const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id,
        baseApprovedRevisionId: f.revision.id, sourceGraphRevisionId: f.graph.graphRevision.id,
        specification: specification() });
      f.service.approveTicketRevision(draft.revision.id);
    }
    return f.ports.transactions.run(operation);
  } } });

  // 操作／驗證：首次 request 必須以 transaction 內目前狀態拒絕，不保存 intent。
  expect(() => target.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: command.external_container_id, idempotencyKey: "interleaved" }))
    .toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(count("sync_intents")).toBe(0);
});

it("scopes replay keys by LocalActor while preventing duplicate owner exports", async () => {
  await request();
  expect(error(await request({ idempotency_key: "another-key" }))).toBe("CONFLICT");
  const other = anotherTicket();
  const secondActor = new ProductGraphService(f.ports, { actor: { id: "second-exporter", displayName: "Exporter" } });
  const exported = secondActor.requestPlaneTicketExport({ ticketId: other.ticket.id, sourceTicketRevisionId: other.revision.id,
    externalContainerId: command.external_container_id, idempotencyKey: command.idempotency_key.trim() });
  expect(exported.syncIntent.idempotencyKey).not.toBe(f.ports.syncIntents.listByTicketId(f.ticket.id)[0]!.idempotencyKey);
  expect(() => secondActor.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: command.external_container_id, idempotencyKey: "new-actor-key" })).toThrow(expect.objectContaining({ code: "CONFLICT" }));
});

it("allows the same actor and client key in a different Project scope", async () => {
  await request();
  const project = f.service.createProject({ name: "Second export Project" }).project;
  const idea = f.service.addIdea({ projectId: project.id, content: "Export", source: "test" }).idea;
  const brief = f.service.createProductBriefDraft({ projectId: project.id, sourceIdeaId: idea.id, baseApprovedVersionId: null,
    brief: { product_goal: "Export", target_users: [], pain_points: [], core_workflows: [],
      mvp_scope: [], non_goals: [], success_metrics: [], risks: [], open_questions: [] } });
  f.service.approveProductBriefVersion(brief.version.id);
  const graph = f.service.createGraphDraftBatch({ projectId: project.id, baseGraphRevisionId: null,
    sourceProductBriefVersionId: brief.version.id, changes: [{ changeId: "goal", operation: "add", entityKind: "node",
      targetId: null, payload: { type: "product_goal", title: "Export" } }] });
  const applied = f.service.approveGraphDraftBatch(graph.graphDraftBatch.id);
  const goal = applied.applied.addedIds[0]!;
  const repository = f.service.createRepository({ projectId: project.id, slug: "app", name: "App" }).repository;
  const draft = f.service.createTicketDraftBatch({ projectId: project.id, sourceGraphRevisionId: applied.graphRevision.id,
    sourceNodeIds: [goal], tickets: [{ ...specification(), relatedGraphNodeIds: [goal],
      implementationTargets: [{ repositoryId: repository.id, scope: [] }] }] });
  const approved = f.service.approveTicketRevision(draft.tickets[0]!.revision.id);
  const response = await request({ ticket_id: approved.ticket.id, source_ticket_revision_id: approved.revision.id });
  expect(response.isError).not.toBe(true);
  const first = f.ports.syncIntents.listByTicketId(f.ticket.id)[0]!;
  const second = f.ports.syncIntents.listByTicketId(approved.ticket.id)[0]!;
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(second.projectId).toBe(project.id);
  expect(count("sync_intents")).toBe(2);
});

it("replays the pinned request after supersession but rejects the old revision on a new request", async () => {
  const original = await request();
  const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id,
    baseApprovedRevisionId: f.revision.id, sourceGraphRevisionId: f.graph.graphRevision.id,
    specification: specification() });
  f.service.approveTicketRevision(draft.revision.id);
  expect(await request()).toEqual(original);
  expect(error(await request({ idempotency_key: "old-revision-new-key" }))).toBe("CONFLICT");
  expect(count("sync_intents")).toBe(1);
});

it("allows a new request after a successful create when no active mapping remains", async () => {
  await request();
  const intent = f.ports.syncIntents.listByTicketId(f.ticket.id)[0]!;
  f.database.prepare(`INSERT INTO sync_attempts (id,sync_intent_id,operation,idempotency_key,started_at,completed_at,result_status)
    VALUES ('successful-create',?,'create',?,'2026-09-27T00:00:00Z','2026-09-27T00:01:00Z','succeeded')`).run(intent.id, intent.idempotencyKey);
  expect((await request({ idempotency_key: "new-after-success" })).isError).not.toBe(true);
  expect(count("sync_intents")).toBe(2);
});

it("keeps failed creates outstanding and enforces the same invariant in storage", async () => {
  await request();
  const intent = f.ports.syncIntents.listByTicketId(f.ticket.id)[0]!;
  f.database.prepare(`INSERT INTO sync_attempts (id,sync_intent_id,operation,idempotency_key,started_at,completed_at,result_status)
    VALUES ('failed-create',?,'create',?,'2026-09-27T00:00:00Z','2026-09-27T00:01:00Z','failed')`).run(intent.id, intent.idempotencyKey);
  expect(error(await request({ idempotency_key: "retry-with-new-key" }))).toBe("CONFLICT");
  expect(() => f.ports.syncIntents.insert({ ...intent, id: "second-intent", idempotencyKey: "bypass-key" })).toThrow();
  expect(count("sync_intents")).toBe(1);
});

it("rejects an active owner/container mapping even without a pending request", async () => {
  f.database.prepare(`INSERT INTO external_work_items (id,external_container_id,provider,external_id,lifecycle_status,created_at,updated_at)
    VALUES ('mapped-item',?,'plane','external-id','active','now','now')`).run(command.external_container_id);
  f.database.prepare(`INSERT INTO external_work_item_mappings (id,project_id,internal_owner_type,internal_owner_id,
    external_container_id,external_work_item_id,source_ticket_revision_id,lifecycle_status,created_at,updated_at)
    VALUES ('mapping',?,'ticket',?,?,'mapped-item',?,'active','now','now')`)
    .run(f.project.id, f.ticket.id, command.external_container_id, f.revision.id);
  expect(error(await request())).toBe("CONFLICT");
  expect(count("sync_intents")).toBe(0);
});

it("rolls back first actor, audit and intent on failure and allows retry with the same key", async () => {
  const service = new ProductGraphService(f.ports, { actor: { id: "new-exporter", displayName: "New exporter" } });
  const next = await connect(service);
  const audits = count("audit_log");
  try {
    f.database.exec(`CREATE TRIGGER reject_export_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'plane_ticket_export.requested' BEGIN SELECT RAISE(ABORT, 'reject export audit'); END`);
    expect(error(await next.client.callTool({ name: "request_plane_ticket_export", arguments: command }))).toBe("STORAGE_ERROR");
    expect(count("sync_intents")).toBe(0);
    expect(count("audit_log")).toBe(audits);
    expect(f.database.prepare("SELECT id FROM local_actors WHERE id = 'new-exporter'").get()).toBeUndefined();
    f.database.exec("DROP TRIGGER reject_export_audit");
    expect((await next.client.callTool({ name: "request_plane_ticket_export", arguments: command })).isError).not.toBe(true);
  } finally { await next.close(); }
});

it("replays the pinned response after reopening storage", async () => {
  const original = await request();
  const directory = mkdtempSync(join(tmpdir(), "apg-export-request-"));
  try {
    const path = join(directory, "request.sqlite");
    await f.database.backup(path);
    const database = openDatabase(path);
    try {
      const next = await connect(new ProductGraphService(createSqlitePorts(database), {
        actor: { id: "acceptance-user", displayName: "Reviewer" }
      }));
      try { expect(await next.client.callTool({ name: "request_plane_ticket_export", arguments: command })).toEqual(original); }
      finally { await next.close(); }
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally { database.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("rejects forged actor/hash/time and empty keys at the closed MCP boundary", async () => {
  for (const extra of [{ actor_id: "forged" }, { payload_hash: "forged" }, { created_at: "forged" }, { idempotency_key: " " }]) {
    expect((await request(extra)).isError).toBe(true);
  }
  expect(count("sync_intents")).toBe(0);
});

function request(overrides: Record<string, unknown> = {}) {
  return connection.client.callTool({ name: "request_plane_ticket_export", arguments: { ...command, ...overrides } });
}
function error(response: Awaited<ReturnType<typeof request>>) {
  expect(response.isError).toBe(true);
  return JSON.parse((response.content as Array<{ text: string }>)[0]!.text).error.code as string;
}
function count(table: string) { return (f.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count; }
function totalChanges() { return f.database.prepare("SELECT total_changes() AS count").get(); }
function specification() {
  return { title: "Another Ticket", userStory: "As a user, I can export", scope: [], acceptanceCriteria: ["Exportable"],
    nonGoals: [], relatedGraphNodeIds: [f.goal], implementationNotes: [],
    implementationTargets: f.revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope })) };
}
function anotherTicket() {
  const draft = f.service.createTicketDraftBatch({ projectId: f.project.id, sourceGraphRevisionId: f.graph.graphRevision.id,
    sourceNodeIds: [f.goal], tickets: [specification()] });
  return f.service.approveTicketRevision(draft.tickets[0]!.revision.id);
}
async function connect(service: ProductGraphService) {
  const server = createMcpServer(service);
  const client = new Client({ name: "plane-export-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, async close() { await client.close(); await server.close(); } };
}
