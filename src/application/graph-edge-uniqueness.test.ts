import { afterEach, describe, expect, it } from "vitest";
import type { GraphChangeInput } from "./graph-workflow.js";
import { ProductGraphService } from "./product-graph-service.js";
import { openDatabase, type SqliteDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";

let database: SqliteDatabase;
afterEach(() => database?.close());

function fixture() {
  database = openDatabase(":memory:");
  const ports = createSqlitePorts(database);
  const target = new ProductGraphService(ports, { actor: { id: "reviewer", displayName: "Reviewer" } });
  const projectId = target.createProject({ name: "Unique edges" }).project.id;
  const idea = target.addIdea({ projectId, content: "Unique graph", source: "test" }).idea;
  const brief = target.createProductBriefDraft({ projectId, sourceIdeaId: idea.id, baseApprovedVersionId: null,
    brief: { product_goal: "Unique graph", target_users: [], pain_points: [], core_workflows: [],
      mvp_scope: [], non_goals: [], success_metrics: [], risks: [], open_questions: [] } });
  target.approveProductBriefVersion(brief.version.id);
  const initial = target.createGraphDraftBatch({ projectId, sourceProductBriefVersionId: brief.version.id,
    baseGraphRevisionId: null, changes: [
      ...["source", "target"].map(changeId => ({ changeId, entityKind: "node" as const,
        operation: "add" as const, targetId: null, payload: { type: "product_goal", title: changeId } })),
      ...["supports", "solves"].map(relation => ({ changeId: relation, entityKind: "edge" as const,
        operation: "add" as const, targetId: null, payload: { source_change_id: "source", target_change_id: "target", relation_type: relation } }))
    ] });
  const approval = target.approveGraphDraftBatch(initial.graphDraftBatch.id);
  const edges = ports.graphEdges.list(projectId, "active");
  const supports = edges.find(edge => edge.relationType === "supports")!;
  const solves = edges.find(edge => edge.relationType === "solves")!;
  const update = (id: string, relation: string): GraphChangeInput => ({ changeId: id, entityKind: "edge", operation: "update", targetId: id, payload: { relation_type: relation } });
  const archive = (id: string): GraphChangeInput => ({ changeId: `archive-${id}`, entityKind: "edge", operation: "archive", targetId: id, payload: {} });
  const add = (relation: string): GraphChangeInput => ({ changeId: `add-${relation}`, entityKind: "edge", operation: "add", targetId: null,
    payload: { source_node_id: supports.sourceNodeId, target_node_id: supports.targetNodeId, relation_type: relation } });
  const draft = (changes: GraphChangeInput[]) => target.createGraphDraftBatch({ projectId,
    sourceProductBriefVersionId: brief.version.id, baseGraphRevisionId: approval.graphRevision.id, changes });
  const snapshot = () => ({
    project: ports.projects.findById(projectId), edges: ports.graphEdges.list(projectId),
    revisions: database.prepare("SELECT * FROM graph_revisions ORDER BY sequence_number").all(),
    batches: database.prepare("SELECT * FROM graph_draft_batches ORDER BY id").all(), audit: ports.auditLog.list()
  });
  return { target, ports, projectId, supports, solves, update, archive, add, draft, snapshot };
}

for (const reverse of [false, true]) {
  describe(`final graph uniqueness, reversed=${reverse}`, () => {
    it.each(["update-existing", "updates-converge", "add-update", "add-add"])("persists %s collisions and blocks approval atomically", scenario => {
      // 準備不同來源的碰撞，再交換 changes 順序驗證結果一致。
      const f = fixture();
      const cases: Record<string, GraphChangeInput[]> = {
        "update-existing": [f.update(f.solves.id, "supports")],
        "updates-converge": [f.update(f.supports.id, "traces_to"), f.update(f.solves.id, "traces_to")],
        "add-update": [f.add("traces_to"), f.update(f.solves.id, "traces_to")],
        "add-add": [f.add("traces_to"), { ...f.add("traces_to"), changeId: "second-add" }]
      };
      const changes = cases[scenario]!;
      const draft = f.draft(reverse ? changes.reverse() : changes);
      const before = f.snapshot();

      expect(draft.validation.conflicts).toHaveLength(changes.length);
      expect(draft.validation.conflicts.every(conflict => conflict.code === "DUPLICATE_EDGE")).toBe(true);
      expect(f.ports.graphDraftBatches.listChanges(draft.graphDraftBatch.id).every(change => change.conflict?.code === "DUPLICATE_EDGE")).toBe(true);
      expect(() => f.target.approveGraphDraftBatch(draft.graphDraftBatch.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
      expect(f.snapshot()).toEqual(before);
    });

    it.each(["swap", "archive-add", "archive-update", "single-update"])("approves a unique final graph for %s", scenario => {
      const f = fixture();
      const cases: Record<string, GraphChangeInput[]> = {
        swap: [f.update(f.supports.id, "solves"), f.update(f.solves.id, "supports")],
        "archive-add": [f.archive(f.supports.id), f.add("supports")],
        "archive-update": [f.archive(f.supports.id), f.update(f.solves.id, "supports")],
        "single-update": [f.update(f.solves.id, "traces_to")]
      };
      const changes = cases[scenario]!;
      const draft = f.draft(reverse ? changes.reverse() : changes);

      const result = f.target.approveGraphDraftBatch(draft.graphDraftBatch.id);

      expect(draft.validation.conflicts).toEqual([]);
      expect(result.graphRevision.sequenceNumber).toBe(2);
      const edges = f.ports.graphEdges.list(f.projectId, "active");
      expect(edges.map(edge => edge.relationType).sort()).toEqual(scenario === "archive-update"
        ? ["supports"] : scenario === "single-update" ? ["supports", "traces_to"] : ["solves", "supports"]);
      if (scenario === "swap") {
        expect(f.ports.graphEdges.findById(f.supports.id)?.relationType).toBe("solves");
        expect(f.ports.graphEdges.findById(f.solves.id)?.relationType).toBe("supports");
      }
      if (scenario.startsWith("archive")) expect(f.ports.graphEdges.findById(f.supports.id)?.lifecycleStatus).toBe("archived");
    });
  });
}

it("revalidates stored changes at approval and preserves every persistent side effect on conflict", () => {
  const f = fixture();
  const draft = f.draft([f.update(f.solves.id, "traces_to")]);
  expect(draft.validation.conflicts).toEqual([]);
  // 模擬 draft 建立後的 canonical 狀態變動，確認 approval 不只信任先前 validation。
  f.ports.graphEdges.insert({ ...f.supports, id: "late-edge", relationType: "traces_to" });
  const before = f.snapshot();

  expect(() => f.target.approveGraphDraftBatch(draft.graphDraftBatch.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));

  expect(f.snapshot()).toEqual(before);
});

it("stores duplicate proposed-node edges as conflicts before assigning canonical node IDs", () => {
  const f = fixture();
  const edge = { ...f.add("supports"), payload: { source_change_id: "new", target_node_id: f.supports.targetNodeId, relation_type: "supports" } };
  const draft = f.draft([{ changeId: "new", entityKind: "node", operation: "add", targetId: null,
    payload: { type: "product_goal", title: "New goal" } }, edge, { ...edge, changeId: "duplicate" }]);

  expect(draft.validation.conflicts).toHaveLength(2);
  expect(() => f.target.approveGraphDraftBatch(draft.graphDraftBatch.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
});

it.each([false, true])("rejects ambiguous relation updates to the same edge, reversed=%s", reverse => {
  const f = fixture();
  const changes = [f.update(f.solves.id, "traces_to"), { ...f.update(f.solves.id, "supports"), changeId: "other-relation" }];
  const draft = f.draft(reverse ? changes.reverse() : changes);

  expect(draft.validation.conflicts.map(conflict => conflict.code)).toEqual(["AMBIGUOUS_EDGE_UPDATE", "AMBIGUOUS_EDGE_UPDATE"]);
  expect(() => f.target.approveGraphDraftBatch(draft.graphDraftBatch.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
});

it("rejects a resulting graph with unchanged legacy duplicates", () => {
  const f = fixture();
  f.ports.graphEdges.insert({ ...f.supports, id: "legacy-duplicate" });
  const draft = f.draft([{ changeId: "metadata", entityKind: "node", operation: "update", targetId: f.supports.sourceNodeId, payload: { metadata: { reviewed: true } } }]);
  const before = f.snapshot();

  expect(draft.validation.conflicts).toEqual([expect.objectContaining({ change_id: null, code: "DUPLICATE_EDGE" })]);
  expect(() => f.target.approveGraphDraftBatch(draft.graphDraftBatch.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.snapshot()).toEqual(before);
});
