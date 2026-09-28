import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createFullMcpServer as createMcpServer } from "../../test-support/full-mcp-server.js";

let database: ReturnType<typeof openDatabase>;
let ports: ReturnType<typeof createSqlitePorts>;
let service: ProductGraphService;
let client: Client;
let server: ReturnType<typeof createMcpServer>;

beforeEach(async () => {
  database = openDatabase(":memory:");
  ports = createSqlitePorts(database);
  service = new ProductGraphService(ports);
  server = createMcpServer(service);
  client = new Client({ name: "trace-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await Promise.allSettled([client?.close(), server?.close()]);
  database?.close();
});

it("follows incoming/outgoing chains and honors zero and exact depth boundaries", async () => {
  const graph = fixture("chain");
  edge(graph, "ab", "a", "b");
  edge(graph, "bc", "b", "c");
  edge(graph, "cd", "c", "d");
  const zero = await trace(graph.nodes.a!, "both", 0);
  expect(ids(zero.nodes)).toEqual([graph.nodes.a]);
  expect(zero.edges).toEqual([]);
  expect(zero.paths).toEqual([{ node_ids: [graph.nodes.a], edge_ids: [] }]);
  expect(ids((await trace(graph.nodes.a!, "outgoing", 1)).nodes)).toEqual(sorted(graph, ["a", "b"]));
  const depthTwo = await trace(graph.nodes.a!, "outgoing", 2);
  expect(ids(depthTwo.nodes)).toEqual(sorted(graph, ["a", "b", "c"]));
  expect(depthTwo.paths).toContainEqual({ node_ids: [graph.nodes.a, graph.nodes.b, graph.nodes.c], edge_ids: ["chain-ab", "chain-bc"] });
  expect(ids((await trace(graph.nodes.a!, "incoming", 3)).nodes)).toEqual([graph.nodes.a]);
  expect(ids((await trace(graph.nodes.c!, "incoming", 1)).nodes)).toEqual(sorted(graph, ["b", "c"]));
  expect(ids((await trace(graph.nodes.b!, "both", 1)).nodes)).toEqual(sorted(graph, ["a", "b", "c"]));
});

it("terminates cycles, preserves traversed edges, and selects a deterministic shortest path", async () => {
  const graph = fixture("cycle");
  edge(graph, "40-ca", "c", "a");
  edge(graph, "30-cd", "c", "d");
  edge(graph, "20-bd", "b", "d");
  edge(graph, "11-ac", "a", "c");
  edge(graph, "10-ab", "a", "b");
  edge(graph, "50-aa", "a", "a");
  const first = await trace(graph.nodes.a!, "outgoing", 10);
  expect(first).toEqual(await trace(graph.nodes.a!, "outgoing", 10));
  expect(first.nodes).toHaveLength(4);
  expect(first.edges).toHaveLength(6);
  expect(first.paths).toHaveLength(4);
  expect(first.paths).toContainEqual({ node_ids: [graph.nodes.a, graph.nodes.b, graph.nodes.d], edge_ids: ["cycle-10-ab", "cycle-20-bd"] });
  for (const path of first.paths) expect(new Set(path.node_ids).size).toBe(path.node_ids.length);
});

it("excludes archived neighbors/edges and isolates another project's nodes even with a malformed edge", async () => {
  const graph = fixture("scope");
  const other = fixture("other");
  edge(graph, "ab", "a", "b");
  edge(graph, "ac", "a", "c");
  ports.graphNodes.archive(graph.nodes.b!, graph.revisionId, graph.now);
  ports.graphEdges.archive("scope-ac", graph.revisionId, graph.now);
  ports.graphEdges.insert({
    ...ports.graphEdges.findById("scope-ab")!, id: "scope-cross-project",
    targetNodeId: other.nodes.a!, lifecycleStatus: "active"
  });
  const result = await trace(graph.nodes.a!);
  expect(ids(result.nodes)).toEqual([graph.nodes.a]);
  expect(result.edges).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(other.projectId);
  const historical = await read(`nodes/${graph.nodes.b}`);
  expect(historical.node.lifecycle_status).toBe("archived");
  const archivedTrace = await trace(graph.nodes.b!);
  expect(ids(archivedTrace.nodes)).toEqual([graph.nodes.b]);
  expect(archivedTrace.edges).toEqual([]);
});

it("exposes four resource templates and returns the same default trace without writes", async () => {
  const graph = fixture("resources");
  edge(graph, "ab", "a", "b");
  const before = ports.auditLog.list().length;
  const templates = await client.listResourceTemplates();
  expect(templates.resourceTemplates.map(item => item.uriTemplate)).toEqual(expect.arrayContaining([
    "product-graph://tickets/{ticketId}", "product-graph://tickets/{ticketId}/context",
    "product-graph://nodes/{nodeId}", "product-graph://nodes/{nodeId}/trace"
  ]));
  expect(await read(`nodes/${graph.nodes.a}/trace`)).toEqual(await trace(graph.nodes.a!));
  expect(await read(`nodes/${graph.nodes.a}`)).toMatchObject({ node: { id: graph.nodes.a } });
  expect(ports.auditLog.list()).toHaveLength(before);
});

it("reads Ticket identity and approved context, and preserves explicit historical identity reads", async () => {
  const graph = fixture("ticket");
  ports.repositories.insert({ id: "repo", projectId: graph.projectId, slug: "repo", name: "Repo",
    rootPath: null, remoteUrl: null, lifecycleStatus: "active", createdAt: graph.now, updatedAt: graph.now });
  const created = service.createTicketDraftBatch({
    projectId: graph.projectId, sourceGraphRevisionId: graph.revisionId, sourceNodeIds: [graph.nodes.a!],
    tickets: [{ title: "Deliver", userStory: "Deliver goal", scope: ["Goal"], acceptanceCriteria: ["Goal reached"],
      nonGoals: [], relatedGraphNodeIds: [graph.nodes.a!], implementationNotes: [],
      implementationTargets: [{ repositoryId: "repo", scope: ["Goal"] }] }]
  }).tickets[0]!;
  expect(await read(`tickets/${created.ticket.id}`)).toMatchObject({ ticket: { current_approved_revision_id: null } });
  await expect(read(`tickets/${created.ticket.id}/context`)).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  service.approveTicketRevision(created.revision.id);
  const context = await read(`tickets/${created.ticket.id}/context`);
  expect(context).toMatchObject({ ticket: { id: created.ticket.id }, revision: { id: created.revision.id }, related_nodes: [{ id: graph.nodes.a }] });
  const other = fixture("context-other");
  database.prepare("INSERT INTO ticket_revision_graph_nodes (ticket_revision_id, graph_node_id, relation_type, created_at) VALUES (?, ?, 'traces_to', ?)")
    .run(created.revision.id, other.nodes.a!, graph.now);
  expect(JSON.stringify(await read(`tickets/${created.ticket.id}/context`))).not.toContain(other.nodes.a);
  ports.graphNodes.archive(graph.nodes.a!, graph.revisionId, graph.now);
  expect(await read(`tickets/${created.ticket.id}/context`)).toMatchObject({ related_nodes: [{ lifecycle_status: "archived" }] });
  database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(created.ticket.id);
  expect(await read(`tickets/${created.ticket.id}`)).toMatchObject({ ticket: { lifecycle_status: "archived" } });
  await expect(read(`tickets/${created.ticket.id}/context`)).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

it("reports missing IDs and rejects invalid depth/direction input", async () => {
  for (const path of ["nodes/missing", "nodes/missing/trace", "tickets/missing", "tickets/missing/context"]) {
    await expect(read(path)).rejects.toMatchObject({ code: -32002, data: { code: "NOT_FOUND" } });
  }
  const missing = await client.callTool({ name: "get_node_trace", arguments: { node_id: "missing" } });
  expect(missing.isError).toBe(true);
  expect(JSON.parse((missing.content as { text: string }[])[0]!.text)).toMatchObject({ error: { code: "NOT_FOUND" } });
  for (const args of [{ max_depth: -1 }, { max_depth: 11 }, { max_depth: 0.5 }, { direction: "sideways" }]) {
    const result = await client.callTool({ name: "get_node_trace", arguments: { node_id: "missing", ...args } });
    expect(result.isError).toBe(true);
  }
});

function fixture(name: string) {
  const project = service.createProject({ name }).project;
  const idea = service.addIdea({ projectId: project.id, content: name, source: "test" }).idea;
  const brief = service.createProductBriefDraft({ projectId: project.id, sourceIdeaId: idea.id, baseApprovedVersionId: null,
    brief: { product_goal: name, target_users: [], pain_points: [], core_workflows: [], mvp_scope: [], non_goals: [], success_metrics: [], risks: [], open_questions: [] } });
  service.approveProductBriefVersion(brief.version.id);
  const batch = service.createGraphDraftBatch({ projectId: project.id, sourceProductBriefVersionId: brief.version.id, baseGraphRevisionId: null,
    changes: ["a", "b", "c", "d"].map(id => ({ changeId: id, operation: "add", entityKind: "node", targetId: null, payload: { type: "product_goal", title: id } })) });
  const approval = service.approveGraphDraftBatch(batch.graphDraftBatch.id);
  const nodes = Object.fromEntries(service.getGraphContext({ projectId: project.id }).nodes.map(node => [node.title, node.id]));
  return { name, projectId: project.id, revisionId: approval.graphRevision.id, nodes, now: "2026-09-27T00:00:00.000Z" };
}

function edge(graph: ReturnType<typeof fixture>, id: string, source: string, target: string) {
  ports.graphEdges.insert({ id: `${graph.name}-${id}`, projectId: graph.projectId, sourceNodeId: graph.nodes[source]!,
    targetNodeId: graph.nodes[target]!, relationType: "supports", confidence: null, lifecycleStatus: "active",
    createdInGraphRevisionId: graph.revisionId, lastChangedInGraphRevisionId: graph.revisionId,
    metadata: {}, createdAt: graph.now, updatedAt: graph.now });
}

function sorted(graph: ReturnType<typeof fixture>, names: string[]) { return names.map(name => graph.nodes[name]).sort(); }
function ids(nodes: { id: string }[]) { return nodes.map(node => node.id); }

async function trace(nodeId: string, direction = "both", maxDepth = 3) {
  const result = await client.callTool({ name: "get_node_trace", arguments: { node_id: nodeId, direction, max_depth: maxDepth } });
  expect(result.isError).not.toBe(true);
  return JSON.parse((result.content as { text: string }[])[0]!.text).data;
}

async function read(path: string) {
  const result = await client.readResource({ uri: `product-graph://${path}` });
  const content = result.contents[0]!;
  if (!("text" in content)) throw new Error("Expected JSON resource");
  return JSON.parse(content.text as string);
}
