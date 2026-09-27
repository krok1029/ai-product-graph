import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import type { SyncAttempt, SyncIntent } from "../../domain/sync-intent.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";
import { createMcpServer } from "./server.js";
import type { ToolEnvelope } from "./tool-envelope.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function fixture() {
  const context = acceptanceFixture();
  const { database, project, ticket, revision } = context;
  cleanup.push(() => database.close());
  const now = "2026-09-27T01:00:00.000Z";
  function intent(id: string, overrides: Partial<SyncIntent> = {}) {
    // 各需求使用不同 container，符合每個 owner/container 僅一筆 outstanding create 的限制。
    const containerId = `container-${id}`;
    database.prepare(`INSERT INTO external_containers (id, provider, workspace_identity,
      container_identity, created_at, updated_at) VALUES (?, 'plane', 'workspace', ?, ?, ?)`)
      .run(containerId, containerId, now, now);
    const value: SyncIntent = { id, projectId: project.id, mappingId: null, externalContainerId: containerId,
      sequenceNumber: null, operation: "create", sourceEventType: "plane_ticket_export_requested",
      sourceEventId: "original-event", sourceTicketRevisionId: revision.id, payloadHash: "pinned-hash",
      payload: { schema_version: 1, owner: { type: "ticket", id: ticket.id },
        source_ticket_revision_id: revision.id, specification: { title: "Pinned original title" } },
      idempotencyKey: `key-${id}`, supersedesSyncIntentId: null, lifecycleStatus: "active", createdAt: now, ...overrides };
    database.prepare(`INSERT INTO sync_intents (id, project_id, mapping_id, external_container_id,
      sequence_number, operation, source_event_type, source_event_id, source_ticket_revision_id,
      payload_hash, payload_json, idempotency_key, supersedes_sync_intent_id, lifecycle_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.projectId, value.mappingId,
      value.externalContainerId, value.sequenceNumber, value.operation, value.sourceEventType, value.sourceEventId,
      value.sourceTicketRevisionId, value.payloadHash, JSON.stringify(value.payload), value.idempotencyKey,
      value.supersedesSyncIntentId, value.lifecycleStatus, value.createdAt);
    return value;
  }
  function attempt(id: string, syncIntentId: string, resultStatus: SyncAttempt["resultStatus"], startedAt = now) {
    database.prepare(`INSERT INTO sync_attempts (id, sync_intent_id, operation, idempotency_key,
      started_at, completed_at, result_status, response_json, error_json) VALUES (?, ?, 'create', ?, ?, ?, ?, ?, ?)`)
      .run(id, syncIntentId, `key-${syncIntentId}`, startedAt, resultStatus === "started" ? null : startedAt,
        resultStatus, resultStatus === "succeeded" ? '{"external_id":"remote-1"}' : null,
        resultStatus === "failed" ? '{"code":"TIMEOUT"}' : null);
  }
  return { ...context, intent, attempt };
}

async function clientFor(service: ProductGraphService) {
  const server = createMcpServer(service);
  const client = new Client({ name: "sync-intent-tests", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); },
    call: async (name: string, input: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: input });
      return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as ToolEnvelope;
    } };
}

describe("Sync Intent history reads", () => {
  it("exposes pinned requests, empty lists, errors and read-only history through MCP", async () => {
    const { database, ports, service, ticket, intent, attempt } = fixture();
    const target = await clientFor(service);
    const before = domainSnapshot(database);
    const audits = ports.auditLog.list();
    try {
      expect((await target.call("list_ticket_export_requests", { ticket_id: ticket.id })).data).toEqual({ requests: [] });
      expect((await target.call("get_sync_intent", { sync_intent_id: "missing" })).error?.code).toBe("NOT_FOUND");
      expect((await target.call("list_ticket_export_requests", { ticket_id: "missing" })).error?.code).toBe("NOT_FOUND");
      expect(domainSnapshot(database)).toEqual(before);
      expect(ports.auditLog.list()).toEqual(audits);
      const original = intent("first");
      attempt("failure", original.id, "failed");
      const afterFixture = domainSnapshot(database);

      const result = await target.call("get_sync_intent", { sync_intent_id: original.id });
      const listed = await target.call("list_ticket_export_requests", { ticket_id: ticket.id });

      expect(result.ok).toBe(true);
      expect(result.audit_log_id).toBeUndefined();
      expect(result.data).toMatchObject({ sync_intent: {
        id: original.id, external_container_id: original.externalContainerId, payload: original.payload,
        source_ticket_revision_id: original.sourceTicketRevisionId, payload_hash: "pinned-hash"
      }, request_state: "failed", attempts: [{ id: "failure", result_status: "failed", error: { code: "TIMEOUT" }, response: null }] });
      expect(listed.data).toEqual({ requests: [result.data] });
      expect(domainSnapshot(database)).toEqual(afterFixture);
      expect(ports.auditLog.list()).toEqual(audits);
    } finally { await target.close(); }
  });

  it("derives state from chronological attempts without erasing success or archived history", () => {
    const { service: target, intent, attempt } = fixture();
    intent("pending");
    intent("running");
    intent("failed");
    intent("success");
    intent("archived", { lifecycleStatus: "archived" });
    attempt("a", "running", "failed");
    attempt("b", "running", "started");
    attempt("z", "failed", "started", "2026-09-27T00:00:00.000Z");
    attempt("c", "failed", "failed");
    attempt("success-late-failure", "success", "failed", "2026-09-27T03:00:00.000Z");
    attempt("success-ok", "success", "succeeded", "2026-09-27T02:00:00.000Z");
    attempt("success-first-failure", "success", "failed", "2026-09-27T01:00:00.000Z");
    attempt("archived-success", "archived", "succeeded");

    expect(["pending", "running", "failed", "success", "archived"].map(id => target.getSyncIntent(id).requestState))
      .toEqual(["pending", "running", "failed", "succeeded", "archived"]);
    expect(target.getSyncIntent("success").attempts.map(value => value.id))
      .toEqual(["success-first-failure", "success-ok", "success-late-failure"]);
    expect(target.getSyncIntent("running").attempts.map(value => value.id)).toEqual(["a", "b"]);
    expect(target.getSyncIntent("success").attempts[1]!.response).toEqual({ external_id: "remote-1" });
  });

  it("limits lists by revision ownership, Project, event, operation and pinned owner consistency", () => {
    const { database, service: target, project, ticket, revision, intent } = fixture();
    const other = target.createProject({ name: "Other" }).project;
    const original = intent("z-last");
    intent("a-first");
    intent("earlier", { createdAt: "2026-09-26T00:00:00.000Z", lifecycleStatus: "archived" });
    intent("cross-project", { projectId: other.id });
    intent("wrong-owner", { payload: { ...original.payload, owner: { type: "ticket", id: "another" } } });
    intent("wrong-type", { payload: { ...original.payload, owner: { type: "implementation_target", id: ticket.id } } });
    intent("wrong-revision", { payload: { ...original.payload, source_ticket_revision_id: "other" } });
    intent("other-event", { sourceEventType: "ticket_revision_approved" });
    intent("update", { operation: "update" });
    database.prepare(`INSERT INTO tickets (id, project_id, slug, title, lifecycle_status, delivery_status, created_at, updated_at)
      VALUES ('empty-ticket', ?, 'empty-ticket', 'Empty', 'active', 'planned', 'now', 'now')`).run(project.id);
    database.prepare(`INSERT INTO tickets (id, project_id, slug, title, lifecycle_status, delivery_status, created_at, updated_at)
      VALUES ('other-ticket', ?, 'other-ticket', 'Other', 'active', 'planned', 'now', 'now')`).run(other.id);
    database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(ticket.id);
    database.prepare("UPDATE ticket_revisions SET lifecycle_status = 'archived' WHERE id = ?").run(revision.id);

    expect(target.listTicketExportRequests(ticket.id).requests.map(value => value.syncIntent.id))
      .toEqual(["earlier", "a-first", "z-last"]);
    expect(target.listTicketExportRequests("empty-ticket")).toEqual({ requests: [] });
    expect(target.listTicketExportRequests("other-ticket")).toEqual({ requests: [] });
  });

  it("keeps the original projection and full history after Ticket revision changes and database reopen", async () => {
    const { database, service, ticket, revision, intent, attempt, ports } = fixture();
    const original = intent("pinned");
    attempt("one", original.id, "failed");
    attempt("two", original.id, "succeeded");
    ports.ticketRevisions.insert({ ...revision, id: "new-revision", revisionNumber: 2,
      baseApprovedRevisionId: revision.id, title: "New title" }, [], []);
    database.prepare("UPDATE tickets SET title = 'New title', current_approved_revision_id = 'new-revision' WHERE id = ?").run(ticket.id);
    const expected = service.getSyncIntent(original.id);
    const directory = mkdtempSync(join(tmpdir(), "sync-intent-read-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "state.sqlite");
    writeFileSync(path, database.serialize());
    const reopened = openDatabase(path);
    cleanup.push(() => reopened.close());
    const reopenedPorts = createSqlitePorts(reopened);
    const target = await clientFor(new ProductGraphService(reopenedPorts));
    const before = domainSnapshot(reopened);
    const audits = reopenedPorts.auditLog.list();
    try {
      const result = await target.call("get_sync_intent", { sync_intent_id: original.id });
      const listed = await target.call("list_ticket_export_requests", { ticket_id: ticket.id });
      expect(result.data).toMatchObject({ sync_intent: { payload: expected.syncIntent.payload,
        source_ticket_revision_id: revision.id }, request_state: "succeeded" });
      expect((result.data!.attempts as Array<{ id: string }>).map(value => value.id)).toEqual(["one", "two"]);
      expect(listed.data).toEqual({ requests: [result.data] });
      expect(domainSnapshot(reopened)).toEqual(before);
      expect(reopenedPorts.auditLog.list()).toEqual(audits);
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally { await target.close(); }
  });
});
