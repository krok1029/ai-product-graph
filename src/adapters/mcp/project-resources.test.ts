import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createMcpServer } from "./server.js";

let database: ReturnType<typeof openDatabase>;
let ports: ReturnType<typeof createSqlitePorts>;
let service: ProductGraphService;
let target: Client;
let server: ReturnType<typeof createMcpServer>;

beforeEach(async () => {
  database = openDatabase(":memory:");
  ports = createSqlitePorts(database);
  service = new ProductGraphService(ports);
  server = createMcpServer(service);
  target = new Client({ name: "project-resource-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await target.connect(clientTransport);
});

afterEach(async () => {
  await Promise.allSettled([target?.close(), server?.close()]);
  database?.close();
});

it("exposes the project resource templates and explicit empty states", async () => {
  const project = service.createProject({ name: "Empty" }).project;
  const templates = await target.listResourceTemplates();
  expect(templates.resourceTemplates.map(item => item.uriTemplate)).toEqual(expect.arrayContaining([
    "product-graph://projects/{projectId}", "product-graph://projects/{projectId}/brief",
    "product-graph://projects/{projectId}/graph", "product-graph://projects/{projectId}/tickets"
  ]));
  expect(await read(project.id, "brief")).toEqual({ product_brief: null, version: null });
  expect(await read(project.id, "graph")).toEqual({ graph_revision_id: null, nodes: [], edges: [] });
  expect(await read(project.id, "tickets")).toEqual({ tickets: [] });
  const resources = await target.listResources();
  expect(resources.resources.map(item => item.uri)).toContain("product-graph://projects");
});

it("publishes only the current approved brief and follows subsequent approvals", async () => {
  const project = service.createProject({ name: "Brief" }).project;
  const idea = service.addIdea({ projectId: project.id, content: "A product", source: "test" }).idea;
  const first = draft(project.id, idea.id, null, "First goal");
  expect(await read(project.id, "brief")).toEqual({ product_brief: null, version: null });
  service.approveProductBriefVersion(first.version.id);
  const second = draft(project.id, idea.id, first.version.id, "Revised goal");
  expect(await read(project.id, "brief")).toMatchObject({ version: { id: first.version.id, brief: { product_goal: "First goal" } } });
  service.approveProductBriefVersion(second.version.id);
  expect(await read(project.id, "brief")).toMatchObject({
    product_brief: { current_approved_version_id: second.version.id },
    version: { id: second.version.id, review_status: "approved", brief: { product_goal: "Revised goal" } }
  });
});

it("isolates approved graph and ticket reads by project and excludes unapproved tickets", async () => {
  const first = approvedGraph("First");
  const other = approvedGraph("Other");
  const repositoryId = "resource-test-repository";
  ports.repositories.insert({
    id: repositoryId, projectId: first.projectId, slug: "repo", name: "Repo",
    rootPath: null, remoteUrl: null, lifecycleStatus: "active",
    createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z"
  });
  const ticket = service.createTicketDraftBatch({
    projectId: first.projectId, sourceGraphRevisionId: first.revisionId,
    sourceNodeIds: [first.nodeId], tickets: [{
      title: "Deliver first goal", userStory: "User reaches goal", scope: ["Goal"],
      acceptanceCriteria: ["Goal is reached"], nonGoals: [], relatedGraphNodeIds: [first.nodeId],
      implementationTargets: [{ repositoryId, scope: ["Goal"] }], implementationNotes: []
    }]
  }).tickets[0]!;
  expect(await read(first.projectId, "tickets")).toEqual({ tickets: [] });
  service.approveTicketRevision(ticket.revision.id);
  const audits = ports.auditLog.list().length;

  expect(await read(first.projectId, "tickets")).toMatchObject({ tickets: [{ id: ticket.ticket.id, current_approved_revision_id: ticket.revision.id }] });
  expect(await read(other.projectId, "tickets")).toEqual({ tickets: [] });
  const graph = await read(first.projectId, "graph");
  expect(graph).toMatchObject({ graph_revision_id: first.revisionId, nodes: [{ id: first.nodeId }], edges: [] });
  expect(JSON.stringify(graph)).not.toContain(other.nodeId);
  expect(ports.auditLog.list()).toHaveLength(audits);
});

it.each(["brief", "graph", "tickets"])("reports missing and archived project errors for %s", async suffix => {
  await expect(read("missing", suffix)).rejects.toMatchObject({ code: -32002, data: { code: "NOT_FOUND" } });
  const project = service.createProject({ name: "Archived" }).project;
  database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(project.id);
  await expect(read(project.id, suffix)).rejects.toMatchObject({ code: -32602, data: { code: "CONFLICT" } });
});

async function read(projectId: string, suffix: string) {
  const result = await target.readResource({ uri: `product-graph://projects/${projectId}/${suffix}` });
  expect(result.contents).toHaveLength(1);
  const content = result.contents[0]!;
  if (!("text" in content)) throw new Error("Expected JSON resource text");
  return JSON.parse(content.text as string);
}

function draft(projectId: string, ideaId: string, base: string | null, goal: string) {
  return service.createProductBriefDraft({
    projectId, sourceIdeaId: ideaId, baseApprovedVersionId: base,
    brief: { product_goal: goal, target_users: [], pain_points: [], core_workflows: [],
      mvp_scope: [], non_goals: [], success_metrics: [], risks: [], open_questions: [] }
  });
}

function approvedGraph(name: string) {
  const project = service.createProject({ name }).project;
  const idea = service.addIdea({ projectId: project.id, content: name, source: "test" }).idea;
  const brief = draft(project.id, idea.id, null, name);
  service.approveProductBriefVersion(brief.version.id);
  const batch = service.createGraphDraftBatch({
    projectId: project.id, sourceProductBriefVersionId: brief.version.id, baseGraphRevisionId: null,
    changes: [{ changeId: "goal", operation: "add", entityKind: "node", targetId: null,
      payload: { type: "product_goal", title: name } }]
  });
  const approval = service.approveGraphDraftBatch(batch.graphDraftBatch.id);
  return { projectId: project.id, revisionId: approval.graphRevision.id,
    nodeId: service.getGraphContext({ projectId: project.id }).nodes[0]!.id };
}
