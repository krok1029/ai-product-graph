import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import type { ExternalWorkItem, ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../../domain/external-work-item.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";
import { createMcpServer } from "./server.js";
import type { ToolEnvelope } from "./tool-envelope.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const now = "2026-09-27T01:00:00.000Z";

function fixture() {
  const context = acceptanceFixture();
  const { database, service, project, ticket, revision } = context;
  cleanup.push(() => database.close());
  const container = service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace",
    containerIdentity: "container" }).externalContainer;
  function item(id: string, overrides: Partial<ExternalWorkItem> = {}) {
    const value: ExternalWorkItem = { id, externalContainerId: container.id, provider: "plane", externalId: `remote-${id}`,
      externalUrl: null, lifecycleStatus: "active", metadata: { origin: ["provider", null] }, createdAt: now,
      updatedAt: now, archivedAt: null, ...overrides };
    database.prepare(`INSERT INTO external_work_items (id, external_container_id, provider, external_id,
      external_url, lifecycle_status, metadata_json, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.externalContainerId, value.provider,
        value.externalId, value.externalUrl, value.lifecycleStatus, JSON.stringify(value.metadata),
        value.createdAt, value.updatedAt, value.archivedAt);
    return value;
  }
  function mapping(id: string, externalWorkItemId: string, overrides: Partial<ExternalWorkItemMapping> = {}) {
    const value: ExternalWorkItemMapping = { id, projectId: project.id, internalOwnerType: "ticket",
      internalOwnerId: ticket.id, externalContainerId: container.id, externalWorkItemId,
      sourceTicketRevisionId: revision.id, lifecycleStatus: "archived", nextSequenceNumber: 3,
      metadata: { legacy: true }, createdAt: now, updatedAt: now, archivedAt: now, ...overrides };
    database.prepare(`INSERT INTO external_work_item_mappings (id, project_id, internal_owner_type,
      internal_owner_id, external_container_id, external_work_item_id, source_ticket_revision_id,
      lifecycle_status, next_sequence_number, metadata_json, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.projectId, value.internalOwnerType,
        value.internalOwnerId, value.externalContainerId, value.externalWorkItemId, value.sourceTicketRevisionId,
        value.lifecycleStatus, value.nextSequenceNumber, JSON.stringify(value.metadata), value.createdAt,
        value.updatedAt, value.archivedAt);
    return value;
  }
  function snapshot(id: string, externalWorkItemId: string, mappingId: string | null,
    overrides: Partial<ExternalWorkItemSnapshot> = {}) {
    const value: ExternalWorkItemSnapshot = { id, projectId: project.id, externalWorkItemId, mappingId,
      content: JSON.parse('{"title":"Original provider title","labels":[1,null],"__proto__":{"keep":true}}'),
      externalStatus: "closed", concurrencyToken: `etag-${id}`, capturedAt: now, ...overrides };
    database.prepare(`INSERT INTO external_work_item_snapshots (id, project_id, external_work_item_id,
      mapping_id, content_json, external_status, concurrency_token, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(value.id, value.projectId, value.externalWorkItemId, value.mappingId, JSON.stringify(value.content),
        value.externalStatus, value.concurrencyToken, value.capturedAt);
    return value;
  }
  return { ...context, container, item, mapping, snapshot };
}

async function clientFor(service: ProductGraphService) {
  const server = createMcpServer(service);
  const client = new Client({ name: "external-item-tests", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); },
    call: async (name: string, input: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: input });
      return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as ToolEnvelope;
    } };
}

describe("Plane External Work Item history reads", () => {
  it("serializes every persisted field, preserves snapshot JSON, and performs no writes through MCP", async () => {
    const { database, service, ports, ticket, project, container, item, mapping, snapshot } = fixture();
    const original = item("item");
    const link = mapping("mapping", original.id, { lifecycleStatus: "active", archivedAt: null });
    const captured = snapshot("snapshot", original.id, link.id);
    const before = domainSnapshot(database);
    const audits = ports.auditLog.list();
    const actors = database.prepare("SELECT * FROM local_actors").all();
    const target = await clientFor(service);
    try {
      const result = await target.call("get_external_work_item", { external_work_item_id: original.id });
      const expectedItem = { id: original.id, external_container_id: container.id, provider: "plane",
        external_id: original.externalId, external_url: null, lifecycle_status: "active", metadata: original.metadata,
        created_at: now, updated_at: now, archived_at: null };
      const expectedMapping = { id: link.id, project_id: project.id, internal_owner_type: "ticket",
        internal_owner_id: ticket.id, external_container_id: container.id, external_work_item_id: original.id,
        source_ticket_revision_id: link.sourceTicketRevisionId, lifecycle_status: "active", next_sequence_number: 3,
        metadata: link.metadata, created_at: now, updated_at: now, archived_at: null };
      const expectedSnapshot = { id: captured.id, project_id: project.id, external_work_item_id: original.id,
        mapping_id: link.id, content: captured.content, external_status: "closed", concurrency_token: captured.concurrencyToken,
        captured_at: now };
      expect(result.data).toEqual({ external_work_item: expectedItem, mappings: [expectedMapping], snapshots: [expectedSnapshot] });
      expect(result.audit_log_id).toBeUndefined();
      expect((await target.call("list_ticket_external_work_items", { ticket_id: ticket.id })).data)
        .toEqual({ items: [{ external_work_item: expectedItem, mapping: expectedMapping, snapshots: [expectedSnapshot] }] });
      expect(domainSnapshot(database)).toEqual(before);
      expect(ports.auditLog.list()).toEqual(audits);
      expect(database.prepare("SELECT * FROM local_actors").all()).toEqual(actors);
    } finally { await target.close(); }
  });

  it("keeps archived history and orders mappings and snapshots by timestamp then ID across containers", () => {
    const { database, service, project, ticket, revision, container, item, mapping, snapshot } = fixture();
    const second = service.registerExternalContainer({ provider: "plane", workspaceIdentity: "other-workspace",
      containerIdentity: "container" }).externalContainer;
    item("old", { lifecycleStatus: "archived", archivedAt: now });
    item("new", { externalContainerId: second.id });
    mapping("z", "old");
    mapping("a", "old", { createdAt: "2026-09-26T00:00:00.000Z", sourceTicketRevisionId: null });
    mapping("b", "new", { externalContainerId: second.id, lifecycleStatus: "active", archivedAt: null });
    snapshot("z", "old", "a", { content: ["unmodified", 2, null] });
    snapshot("a", "old", "z", { content: null });
    snapshot("earlier", "old", "a", { capturedAt: "2026-09-26T00:00:00.000Z" });
    database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(project.id);
    database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(ticket.id);
    database.prepare("UPDATE ticket_revisions SET lifecycle_status = 'archived' WHERE id = ?").run(revision.id);

    const listed = service.listTicketExternalWorkItems(ticket.id).items;

    expect(listed.map(value => value.mapping.id)).toEqual(["a", "b", "z"]);
    expect(listed.map(value => value.externalWorkItem.externalContainerId)).toEqual([container.id, second.id, container.id]);
    expect(listed[0]!.snapshots.map(value => value.id)).toEqual(["earlier", "z"]);
    expect(service.getExternalWorkItem("old").snapshots.map(value => value.id)).toEqual(["earlier", "a", "z"]);
    expect(service.getExternalWorkItem("old").snapshots[1]!.content).toBeNull();
    expect(service.getExternalWorkItem("old").snapshots[2]!.content).toEqual(["unmodified", 2, null]);
  });

  it("excludes inconsistent Project, owner, revision, provider, container, and snapshot identities", () => {
    const { database, service, project, ticket, revision, goal, item, mapping, snapshot } = fixture();
    const foreignProject = service.createProject({ name: "Other project" }).project;
    const otherContainer = service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace",
      containerIdentity: "other" }).externalContainer;
    item("visible");
    item("other", { externalContainerId: otherContainer.id });
    mapping("valid", "visible");
    snapshot("valid", "visible", "valid");
    mapping("wrong-project", "visible", { projectId: foreignProject.id });
    mapping("wrong-owner", "visible", { internalOwnerId: "unknown-ticket" });
    mapping("wrong-container", "visible", { externalContainerId: otherContainer.id });
    mapping("wrong-type", "visible");
    database.prepare("UPDATE external_work_item_mappings SET internal_owner_type = 'implementation_target' WHERE id = 'wrong-type'").run();
    // Polymorphic owner 沒有 FK；仍須建立有效 Ticket／revision，驗證指向其他 owner 的污染。
    const draft = service.createTicketDraftBatch({ projectId: project.id,
      sourceGraphRevisionId: revision.sourceGraphRevisionId!, sourceNodeIds: [goal], tickets: [{
        title: "Other ticket", userStory: "Separate owner", scope: [], acceptanceCriteria: ["Separate"], nonGoals: [],
        relatedGraphNodeIds: [goal], implementationTargets: [{ repositoryId: service.createRepository({ projectId: project.id, slug: "other", name: "Other" }).repository.id, scope: ["Other"] }], implementationNotes: [] }] });
    mapping("wrong-revision", "visible", { sourceTicketRevisionId: draft.tickets[0]!.revision.id });
    for (const id of ["wrong-project", "wrong-owner", "wrong-container", "wrong-type", "wrong-revision"]) {
      snapshot(`snapshot-${id}`, "visible", id);
    }
    snapshot("foreign-snapshot", "visible", "valid", { projectId: foreignProject.id });
    snapshot("wrong-item-snapshot", "other", "valid");
    snapshot("unscoped-snapshot", "visible", null);
    item("provider-mismatch");
    database.prepare("UPDATE external_work_items SET provider = 'github' WHERE id = 'provider-mismatch'").run();
    mapping("provider-mismatch", "provider-mismatch");
    expect(database.pragma("foreign_key_check")).toEqual([]);

    expect(service.listTicketExternalWorkItems(ticket.id).items.map(value => value.mapping.id)).toEqual(["valid"]);
    const details = service.getExternalWorkItem("visible");
    expect(details.mappings.map(value => value.id)).toEqual(["valid"]);
    expect(details.snapshots.map(value => value.id)).toEqual(["valid"]);
    expect(() => service.getExternalWorkItem("provider-mismatch")).toThrow("was not found");
    expect(service.listTicketExternalWorkItems(draft.tickets[0]!.ticket.id).items).toEqual([]);
  });

  it("returns missing errors, empty known owners and isolated unmapped items, and rejects extra input fields", async () => {
    const { service, ticket, item, snapshot } = fixture();
    item("unmapped");
    snapshot("unverified", "unmapped", null);
    const target = await clientFor(service);
    try {
      expect((await target.call("list_ticket_external_work_items", { ticket_id: ticket.id })).data).toEqual({ items: [] });
      expect((await target.call("get_external_work_item", { external_work_item_id: "unmapped" })).data)
        .toMatchObject({ external_work_item: { id: "unmapped" }, mappings: [], snapshots: [] });
      expect((await target.call("get_external_work_item", { external_work_item_id: "missing" })).error?.code).toBe("NOT_FOUND");
      expect((await target.call("list_ticket_external_work_items", { ticket_id: "missing" })).error?.code).toBe("NOT_FOUND");
      for (const args of [{ ticket_id: ticket.id, project_id: "forged" }, { ticket_id: " " }]) {
        expect((await target.client.callTool({ name: "list_ticket_external_work_items", arguments: args })).isError).toBe(true);
      }
      expect((await target.client.callTool({ name: "get_external_work_item", arguments: {
        external_work_item_id: "unmapped", internal_owner_id: ticket.id } })).isError).toBe(true);
    } finally { await target.close(); }
  });

  it("reads the same immutable history after file database reopen", () => {
    const { database, service, ticket, item, mapping, snapshot } = fixture();
    item("persistent");
    mapping("mapping", "persistent");
    snapshot("snapshot", "persistent", "mapping");
    const expected = service.getExternalWorkItem("persistent");
    const expectedList = service.listTicketExternalWorkItems(ticket.id);
    const directory = mkdtempSync(join(tmpdir(), "external-item-history-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "history.sqlite");
    writeFileSync(path, database.serialize());
    const reopened = openDatabase(path);
    try {
      const reader = new ProductGraphService(createSqlitePorts(reopened));
      expect(reader.getExternalWorkItem("persistent")).toEqual(expected);
      expect(reader.listTicketExternalWorkItems(ticket.id)).toEqual(expectedList);
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally { reopened.close(); }
  });
});
