import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createMcpServer } from "./server.js";

type Context = {
  ticket: { id: string };
  traced_ticket: { id: string; lifecycle_status: string } | null;
  trace_edge: { id: string; source_node_id: string; target_node_id: string } | null;
};
type Trace = { nodes: Array<{ id: string }>; edges: Array<{ id: string }> };
let f: ReturnType<typeof acceptanceFixture>;
let connection: Awaited<ReturnType<typeof connect>>;

beforeEach(async () => {
  f = acceptanceFixture();
  connection = await connect(f.service);
});
afterEach(async () => {
  await connection.close();
  f.database.close();
});

it("returns explicit null lineage in both context interfaces for an ordinary Ticket", async () => {
  const { tool, resource } = await contexts(connection.client, f.ticket.id);
  expect(tool).toMatchObject({ traced_ticket: null, trace_edge: null });
  expect(resource).toEqual(tool);
});

it.each(["active", "archived"] as const)("reads %s original history without broadening active-only trace", async lifecycle => {
  // 前置：原 Ticket 可以是歷史資料；建立關係仍透過正式 workflow。
  if (lifecycle === "archived") {
    f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
  }
  const followup = createFollowup(f.ticket.id);
  const writesBefore = f.database.prepare("SELECT total_changes() AS count").get();

  // 操作：相同 canonical lineage 可由 tool 與 resource 讀取。
  const { tool, resource } = await contexts(connection.client, followup.ticket.id);
  const outgoing = await call<Trace>(connection.client, "get_node_trace", {
    node_id: followup.ticket.id, direction: "outgoing", max_depth: 1
  });
  const node = await resourceData<{ node: { id: string; lifecycle_status: string } }>(
    connection.client, `product-graph://nodes/${f.ticket.id}`
  );

  // 驗證：歷史 context 可見 archived original，BFS 則維持原本過濾契約。
  expect(resource).toEqual(tool);
  expect(tool.traced_ticket).toMatchObject({ id: f.ticket.id, lifecycle_status: lifecycle });
  expect(tool.trace_edge).toMatchObject({ source_node_id: followup.ticket.id, target_node_id: f.ticket.id });
  expect(node.node).toMatchObject({ id: f.ticket.id, lifecycle_status: lifecycle });
  expect(outgoing.nodes.map(item => item.id)).toContain(followup.ticket.id);
  if (lifecycle === "active") {
    expect(outgoing.nodes.map(item => item.id)).toContain(f.ticket.id);
    expect(outgoing.edges.map(item => item.id)).toContain(tool.trace_edge!.id);
    const incoming = await call<Trace>(connection.client, "get_node_trace", { node_id: f.ticket.id, direction: "incoming", max_depth: 1 });
    expect(incoming.nodes.map(item => item.id)).toContain(followup.ticket.id);
    const bounded = await call<Trace>(connection.client, "get_node_trace", { node_id: followup.ticket.id, direction: "outgoing", max_depth: 0 });
    expect(bounded.edges).toEqual([]);
  } else {
    expect(outgoing.nodes.map(item => item.id)).not.toContain(f.ticket.id);
    expect(outgoing.edges).toEqual([]);
  }
  expect(f.database.prepare("SELECT total_changes() AS count").get()).toEqual(writesBefore);
});

it("keeps draft replacement proposals out of canonical context until approval", async () => {
  const followup = createFollowup(f.ticket.id);
  const alternate = createFollowup(null);
  const first = (await contexts(connection.client, followup.ticket.id)).tool;
  const draft = f.service.createTicketRevisionDraft({
    ticketId: followup.ticket.id, baseApprovedRevisionId: followup.revision.id,
    sourceGraphRevisionId: f.graph.graphRevision.id, specification: specification(alternate.ticket.id)
  });

  expect((await contexts(connection.client, followup.ticket.id)).tool).toEqual(first);
  f.service.approveTicketRevision(draft.revision.id);
  const changed = await contexts(connection.client, followup.ticket.id);
  expect(changed.tool.traced_ticket?.id).toBe(alternate.ticket.id);
  expect(changed.tool.trace_edge?.id).not.toBe(first.trace_edge?.id);
  expect(changed.resource).toEqual(changed.tool);

  const removal = f.service.createTicketRevisionDraft({
    ticketId: followup.ticket.id, baseApprovedRevisionId: draft.revision.id,
    sourceGraphRevisionId: f.graph.graphRevision.id, specification: specification(null)
  });
  expect((await contexts(connection.client, followup.ticket.id)).tool).toEqual(changed.tool);
  f.service.approveTicketRevision(removal.revision.id);
  const removed = await contexts(connection.client, followup.ticket.id);
  expect(removed.tool).toMatchObject({ traced_ticket: null, trace_edge: null });
  expect(removed.resource).toEqual(removed.tool);
});

it("returns identical historical lineage after reopening persisted storage", async () => {
  const followup = createFollowup(f.ticket.id);
  f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
  const expected = await contexts(connection.client, followup.ticket.id);
  expect(expected.tool.traced_ticket).toMatchObject({ id: f.ticket.id, lifecycle_status: "archived" });
  expect(expected.tool.trace_edge).not.toBeNull();
  const directory = mkdtempSync(join(tmpdir(), "apg-followup-context-"));
  try {
    const path = join(directory, "project.sqlite");
    await f.database.backup(path);
    const reopened = openDatabase(path);
    try {
      const service = new ProductGraphService(createSqlitePorts(reopened), {
        actor: { id: "context-reader", displayName: "Reader" }
      });
      const next = await connect(service);
      try {
        expect(await contexts(next.client, followup.ticket.id)).toEqual(expected);
        expect(reopened.pragma("foreign_key_check")).toEqual([]);
      } finally { await next.close(); }
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function specification(tracesToTicketId: string | null) {
  return {
    title: "Follow-up", tracesToTicketId, userStory: "As a user, I can trace follow-up work.",
    scope: ["Follow-up"], acceptanceCriteria: ["History remains readable"], nonGoals: [],
    relatedGraphNodeIds: [f.goal], dependencies: [], implementationNotes: [],
    implementationTargets: f.revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope }))
  };
}

function createFollowup(tracesToTicketId: string | null) {
  const draft = f.service.createTicketDraftBatch({ projectId: f.project.id,
    sourceGraphRevisionId: f.graph.graphRevision.id, sourceNodeIds: [f.goal],
    tickets: [specification(tracesToTicketId)] });
  return f.service.approveTicketRevision(draft.tickets[0]!.revision.id);
}

async function connect(service: ProductGraphService) {
  const server = createMcpServer(service);
  const client = new Client({ name: "followup-context-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, async close() { await client.close(); await server.close(); } };
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { data: T }).data;
}

async function resourceData<T>(client: Client, uri: string): Promise<T> {
  const result = await client.readResource({ uri });
  return JSON.parse((result.contents[0] as { text: string }).text) as T;
}

async function contexts(client: Client, ticketId: string) {
  return {
    tool: await call<Context>(client, "get_ticket_context", { ticket_id: ticketId }),
    resource: await resourceData<Context>(client, `product-graph://tickets/${ticketId}/context`)
  };
}
