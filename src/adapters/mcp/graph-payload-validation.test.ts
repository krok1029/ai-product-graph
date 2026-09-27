import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import type { GraphChangeInput } from "../../application/graph-workflow.js";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createMcpServer } from "./server.js";

async function setup() {
  const database = openDatabase(":memory:");
  const ports = createSqlitePorts(database);
  const service = new ProductGraphService(ports, {
    actor: { id: "graph-payload-reviewer", displayName: "Reviewer" }
  });
  const project = service.createProject({ name: "Graph payload validation" }).project;
  const idea = service.addIdea({ projectId: project.id, content: "Validate graph inputs", source: "test" }).idea;
  const brief = service.createProductBriefDraft({ projectId: project.id, sourceIdeaId: idea.id,
    baseApprovedVersionId: null, brief: { product_goal: "Validate inputs", target_users: [], pain_points: [],
      core_workflows: [], mvp_scope: [], non_goals: [], success_metrics: [], risks: [], open_questions: [] } });
  service.approveProductBriefVersion(brief.version.id);
  const draft = service.createGraphDraftBatch({ projectId: project.id, baseGraphRevisionId: null,
    sourceProductBriefVersionId: brief.version.id, changes: [
      ...["source", "target", "isolated"].map(changeId => ({ changeId, operation: "add" as const,
        entityKind: "node" as const, targetId: null, payload: { type: "product_goal", title: changeId } })),
      { changeId: "edge", operation: "add", entityKind: "edge", targetId: null,
        payload: { source_change_id: "source", target_change_id: "target", relation_type: "supports" } }
    ] });
  const applied = service.approveGraphDraftBatch(draft.graphDraftBatch.id);
  const [sourceId, targetId, isolatedId, edgeId] = applied.applied.addedIds as [string, string, string, string];
  const base = { projectId: project.id, baseGraphRevisionId: applied.graphRevision.id,
    sourceProductBriefVersionId: brief.version.id };
  const server = createMcpServer(service);
  const target = new Client({ name: "graph-payload-validation", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await target.connect(clientTransport);
  return { database, ports, service, target, base, sourceId, targetId, isolatedId, edgeId,
    changes: () => database.prepare("SELECT total_changes() AS count").get(),
    async create(change: GraphChangeInput) {
      return target.callTool({ name: "create_graph_draft_batch", arguments: {
        project_id: base.projectId, base_graph_revision_id: base.baseGraphRevisionId,
        source_product_brief_version_id: base.sourceProductBriefVersionId,
        changes: [{ change_id: change.changeId, operation: change.operation, entity_kind: change.entityKind,
          target_id: change.targetId, payload: change.payload }]
      } });
    },
    async close() { await target.close(); await server.close(); database.close(); }
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
const operations: [string, (f: Fixture) => GraphChangeInput][] = [
  ["node add", () => ({ changeId: "add-node", operation: "add", entityKind: "node", targetId: null,
    payload: { type: "product_goal", title: "New goal" } })],
  ["node update", f => ({ changeId: "update-node", operation: "update", entityKind: "node", targetId: f.isolatedId,
    payload: { title: "Updated goal" } })],
  ["node archive", f => ({ changeId: "archive-node", operation: "archive", entityKind: "node",
    targetId: f.isolatedId, payload: {} })],
  ["edge add", f => ({ changeId: "add-edge", operation: "add", entityKind: "edge", targetId: null,
    payload: { source_node_id: f.sourceId, target_node_id: f.targetId, relation_type: "solves" } })],
  ["edge update", f => ({ changeId: "update-edge", operation: "update", entityKind: "edge", targetId: f.edgeId,
    payload: { relation_type: "solves" } })],
  ["edge archive", f => ({ changeId: "archive-edge", operation: "archive", entityKind: "edge",
    targetId: f.edgeId, payload: {} })]
];

for (const key of ["__proto__", "undeclared"]) {
  it.each(operations)(`rejects ${key} in %s through MCP and application without writes`, async (_name, changeFor) => {
    const f = await setup();
    try {
      // JSON own key 必須保留；物件 literal 的 __proto__ 會改變 prototype，不能重現此問題。
      const valid = changeFor(f);
      const payload = JSON.parse(JSON.stringify(valid.payload).slice(0, -1) +
        `${Object.keys(valid.payload).length ? "," : ""}"${key}":{"unexpected":true}}`);
      const change = { ...valid, payload };
      const before = f.changes();

      const response = await f.create(change);

      expect(response.isError).toBe(true);
      expect(JSON.parse((response.content as { text: string }[])[0]!.text)).toEqual({
        ok: false, error: { code: "VALIDATION_ERROR", message: `Unsupported graph payload fields: ${key}.` }
      });
      expect(() => f.service.createGraphDraftBatch({ ...f.base, changes: [change] })).toThrow(
        `Unsupported graph payload fields: ${key}.`
      );
      expect(f.changes()).toEqual(before);
    } finally { await f.close(); }
  });
}

it.each(operations)("accepts and applies a valid %s payload through MCP", async (_name, changeFor) => {
  const f = await setup();
  try {
    const change = changeFor(f);

    const response = await f.create(change);

    expect(response.isError).not.toBe(true);
    const envelope = JSON.parse((response.content as { text: string }[])[0]!.text);
    expect(envelope).toMatchObject({ ok: true, data: { graph_draft_batch: { change_count: 1 },
      validation: { conflicts: [] } } });
    const approval = await f.target.callTool({ name: "approve_graph_draft_batch",
      arguments: { graph_draft_batch_id: envelope.data.graph_draft_batch.id } });
    expect(approval.isError).not.toBe(true);
    const applied = JSON.parse((approval.content as { text: string }[])[0]!.text);
    expect(applied.ok).toBe(true);
    expect(f.database.pragma("foreign_key_check")).toEqual([]);
    const lifecycleStatus = change.operation === "archive" ? "archived" : "active";
    const repository = change.entityKind === "node" ? f.ports.graphNodes : f.ports.graphEdges;
    const expectedFields = change.entityKind === "node"
      ? { title: change.payload.title }
      : { sourceNodeId: f.sourceId, targetNodeId: f.targetId, relationType: "solves" };
    expect(repository.list(f.base.projectId, lifecycleStatus)).toContainEqual(expect.objectContaining({
      lifecycleStatus,
      ...(change.operation === "archive" ? { id: change.targetId } : expectedFields)
    }));
  } finally { await f.close(); }
});

it.each([null, [], "invalid", 42, true, undefined])("rejects non-object payload %j before writes", async payload => {
  const f = await setup();
  try {
    const before = f.changes();

    const response = await f.create({ changeId: "invalid", operation: "archive", entityKind: "node",
      targetId: f.isolatedId, payload: payload as unknown as Record<string, unknown> });

    expect(response.isError).toBe(true);
    expect((response.content as { text: string }[])[0]!.text).toContain("payload must be an object.");
    expect(f.changes()).toEqual(before);
  } finally { await f.close(); }
});
