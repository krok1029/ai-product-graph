// 在公開 MCP 邊界驗證完整規劃鏈、來源失效與原子回滾，沿用真實 SQLite。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createMcpServer } from "./server.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";

const milestone = { type: "milestone" as const, content: { outcome: "可完成一次計時", exit_criteria: ["開始至結束可驗證"],
  sequence: 1, scope: ["單一模式"], non_goals: ["同步"] } };
const spec = { type: "spec" as const, content: { problem_statement: "不能控制計時", solution: "開始、暫停與重設",
  user_stories: ["使用者可以暫停並繼續"], implementation_decisions: ["單一時鐘來源"], testing_decisions: ["驗證使用者操作結果"],
  out_of_scope: ["雲端"], further_notes: [] } };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup(path = ":memory:") {
  const database = openDatabase(path);
  const ports = createSqlitePorts(database);
  const service = new ProductGraphService(ports);
  const server = createMcpServer(service);
  const client = new Client({ name: "planning-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const close = async () => { await client.close(); await server.close(); if (database.open) database.close(); };
  cleanups.push(close);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return (result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>)[0]!.text)) as any;
  };
  const project = service.createProject({ name: "Timer" }).project;
  const idea = service.addIdea({ projectId: project.id, content: "計時器", source: "test" }).idea;
  const brief = service.createProductBriefDraft({ projectId: project.id, sourceIdeaId: idea.id, baseApprovedVersionId: null,
    brief: { product_goal: "完成運動計時", target_users: [], pain_points: [], core_workflows: [], mvp_scope: ["計時"],
      non_goals: [], success_metrics: [], risks: [], open_questions: [] } });
  const approved = await call("approve_product_brief_version", { product_brief_version_id: brief.version.id });
  expect(approved.ok).toBe(true);
  expect(approved.data.product_intent_reconciliation.status).toBe("current");
  const repository = service.createRepository({ projectId: project.id, slug: "timer", name: "Timer" }).repository;
  const base = () => ports.projects.findById(project.id)!.currentGraphRevisionId!;
  const save = async (document = milestone as typeof milestone | typeof spec, parent?: string, nodeId?: string, title = document.type) =>
    call("save_planning_node", { project_id: project.id, base_graph_revision_id: base(), change: {
      operation: "save", title, document, ...(parent ? { parent_node_id: parent } : {}), ...(nodeId ? { node_id: nodeId } : {}) } });
  const ticketInput = (specId: string) => ({ title: "控制計時", source_spec_id: specId, user_story: "使用者能開始與暫停", scope: ["完整控制"],
    acceptance_criteria: ["操作可驗證"], non_goals: [], related_graph_node_ids: [],
    implementation_targets: [{ repository_id: repository.id, scope: ["計時"] }], implementation_notes: [] });
  const createTicket = async (specId: string) => call("create_ticket_draft_batch", { project_id: project.id,
    source_graph_revision_id: base(), source_node_ids: [specId], tickets: [ticketInput(specId)] });
  const hierarchy = async () => {
    const m = await save(); expect(m.ok, JSON.stringify(m)).toBe(true);
    const s = await save(spec, m.data.node.id); expect(s.ok, JSON.stringify(s)).toBe(true);
    return { m: m.data.node, s: s.data.node };
  };
  const counts = () => Object.fromEntries(["graph_nodes", "graph_edges", "graph_draft_batches", "graph_revisions", "audit_log", "tickets", "ticket_revisions"]
    .map(table => [table, database.prepare(`SELECT count(*) AS n FROM ${table}`).get()]));
  return { database, ports, service, client, call, project, idea, brief, repository, base, save, ticketInput, createTicket, hierarchy, counts, close };
}

it("projects Brief → Milestone → Spec → Ticket without graph approval and retains structured decisions", async () => {
  const f = await setup();
  const names = (await f.client.listTools()).tools.map(t => t.name);
  expect(names).toHaveLength(23);
  expect(names).not.toContain("approve_graph_draft_batch");
  expect(names).not.toContain("create_graph_draft_batch");
  const { m, s } = await f.hierarchy();
  const draft = await f.createTicket(s.id);
  expect(draft.ok, JSON.stringify(draft)).toBe(true);
  const ticket = draft.data.tickets[0];
  const approved = await f.call("approve_ticket_revision", { ticket_revision_id: ticket.revision.id });
  expect(approved.ok, JSON.stringify(approved)).toBe(true);
  const graph = (await f.call("get_graph_context", { project_id: f.project.id })).data;
  expect(graph.nodes.map((n: any) => n.type).sort()).toEqual(["milestone", "product_brief", "spec", "ticket"]);
  expect(graph.edges.filter((e: any) => e.relation_type === "belongs_to")).toHaveLength(3);
  expect(ticket.revision.specification.source_spec_id).toBe(s.id);
  expect(ticket.revision.specification.related_graph_node_ids).toEqual([s.id, m.id, graph.planning.root_node_id]);
  expect(graph.planning.stale_node_ids).toEqual([]);
  expect(s.metadata.content).toEqual(spec.content);
  const applied = f.ports.auditLog.list().filter(entry => entry.action === "graph_draft_batch.applied");
  expect(applied).toHaveLength(3);
  expect(applied.every(entry => entry.actorId === "planning-automation")).toBe(true);
  expect(f.ports.auditLog.list().some(entry => entry.action === "graph_draft_batch.approved")).toBe(false);
});

it("rejects skipping Spec, wrong parent type, cross-project parents and incomplete Spec content atomically", async () => {
  const f = await setup();
  const { m } = await f.hierarchy();
  const before = f.counts();
  expect((await f.save(spec, f.service.planning.inspect(f.project.id).rootNodeId!)).error.code).toBe("VALIDATION_ERROR");
  expect((await f.createTicket(m.id)).error.code).toBe("VALIDATION_ERROR");
  const foreignProject = f.service.createProject({ name: "Other" }).project;
  expect((await f.call("save_planning_node", { project_id: foreignProject.id, base_graph_revision_id: null,
    change: { operation: "save", title: "bad", parent_node_id: m.id, document: spec } })).ok).toBe(false);
  const { source_spec_id: _unused, ...withoutSpec } = f.ticketInput(m.id);
  const missing = await f.client.callTool({ name: "create_ticket_draft_batch", arguments: {
    project_id: f.project.id, source_graph_revision_id: f.base(), source_node_ids: [m.id], tickets: [withoutSpec] } });
  expect(missing.isError).toBe(true);
  const invalid = await f.client.callTool({ name: "save_planning_node", arguments: { project_id: f.project.id,
    base_graph_revision_id: f.base(), change: { operation: "save", title: "incomplete", parent_node_id: m.id,
      document: { ...spec, content: { ...spec.content, testing_decisions: [] } } } } });
  expect(invalid.isError).toBe(true);
  // 建立另一個 project 只增加自己的 audit；所有失敗都沒有建立規劃與 Ticket。
  const after = f.counts(); delete before.audit_log; delete after.audit_log;
  expect(after).toEqual(before);
});

it("detects stale bases without leaving a draft batch or audit behind", async () => {
  const f = await setup(); const base = f.base(); await f.hierarchy(); const before = f.counts();
  const result = await f.call("save_planning_node", { project_id: f.project.id, base_graph_revision_id: base,
    change: { operation: "save", title: "competing phase", document: milestone } });
  expect(result.error.code).toBe("CONFLICT"); expect(f.counts()).toEqual(before);
});

it("blocks unreconciled ancestry but reuses the approved Ticket and Brief after unchanged Spec revalidation", async () => {
  const f = await setup(); const { m, s } = await f.hierarchy();
  const draft = (await f.createTicket(s.id)).data.tickets[0];
  const approved = (await f.call("approve_ticket_revision", { ticket_revision_id: draft.revision.id })).data;
  const implementation = f.service.createImplementationBriefDraft({ implementationTargetId: approved.implementation_targets[0].id,
    repoContext: { repositoryName: "Timer", summary: "Context", fileList: [], moduleNotes: [], baselineCommitSha: "abc", hasUncommittedChanges: false },
    brief: { implementationPlan: ["Controls"], suggestedFilesToInspect: [], testStrategy: ["Behavior"], risks: [], prSummaryDraft: "Controls" } });
  f.service.approveImplementationBrief(implementation.implementationBrief.id);
  const changed = await f.save({ ...milestone, content: { ...milestone.content, outcome: "雙模式計時" } }, undefined, m.id);
  expect(changed.data.planning.stale_node_ids).toContain(s.id);
  expect(changed.data.planning.affected_ticket_ids).toContain(draft.ticket.id);
  expect((await f.createTicket(s.id)).error.code).toBe("CONFLICT");
  expect((await f.call("start_implementation", { implementation_brief_id: implementation.implementationBrief.id,
    current_repository_state: { commit_sha: "abc" } })).error.code).toBe("STALE_HANDOFF");
  const revalidated = await f.save(spec, m.id, s.id);
  expect(revalidated.ok).toBe(true);
  expect(revalidated.data.node.metadata.content_revision_id).toBe(s.metadata.content_revision_id);
  expect(f.service.planning.inspect(f.project.id).affectedTicketIds).toEqual([]);
  expect((await f.call("start_implementation", { implementation_brief_id: implementation.implementationBrief.id,
    current_repository_state: { commit_sha: "abc" } })).data.freshness).toBe("current");
  expect(f.ports.implementationBriefs.findById(implementation.implementationBrief.id)?.lifecycleStatus).toBe("active");
  expect(f.ports.tickets.findById(draft.ticket.id)?.currentApprovedRevisionId).toBe(draft.revision.id);
  expect(f.ports.ticketRevisions.findById(draft.revision.id)?.sourceGraphRevisionId).toBe(draft.revision.source_graph_revision_id);
});

it("automatically projects a new Brief version and leaves old descendant versions visible as stale", async () => {
  const f = await setup(); const { m, s } = await f.hierarchy(); const root = f.service.planning.inspect(f.project.id).rootNodeId;
  const updated = f.service.createProductBriefDraft({ projectId: f.project.id, sourceIdeaId: f.idea.id,
    baseApprovedVersionId: f.brief.version.id, brief: { ...f.brief.version.brief, product_goal: "改變方向" } });
  // 即使 caller 使用舊 facade，已採用階層的 project 仍自動同步。
  f.service.approveProductBriefVersion(updated.version.id);
  const impact = f.service.planning.inspect(f.project.id);
  expect(impact.rootNodeId).toBe(root); expect(impact.staleNodeIds.sort()).toEqual([m.id, s.id].sort());
  expect(f.ports.graphNodes.findById(root!)?.metadata.product_brief_version_id).toBe(updated.version.id);
  expect((await f.save(spec, m.id, s.id)).error.code).toBe("CONFLICT");
  expect((await f.save(milestone, undefined, m.id)).ok).toBe(true);
  // 階段內容仍相同時，下游不必為父來源確認再次保存。
  expect(f.service.planning.inspect(f.project.id).staleNodeIds).toEqual([]);
});

it("archives a phase and its Specs atomically while preserving Ticket history", async () => {
  const f = await setup(); const { m, s } = await f.hierarchy();
  const draft = (await f.createTicket(s.id)).data.tickets[0];
  await f.call("approve_ticket_revision", { ticket_revision_id: draft.revision.id });
  const result = await f.call("save_planning_node", { project_id: f.project.id, base_graph_revision_id: f.base(),
    change: { operation: "archive", node_id: m.id } });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.data.archived_node_ids.sort()).toEqual([m.id, s.id].sort());
  expect(result.data.planning.affected_ticket_ids).toContain(draft.ticket.id);
  expect(f.ports.tickets.findById(draft.ticket.id)?.lifecycleStatus).toBe("active");
  expect(f.ports.graphEdges.list(f.project.id, "active")).toEqual([]);
  expect(f.database.pragma("foreign_key_check")).toEqual([]);
  expect((await f.save(spec, m.id, s.id)).ok).toBe(false);
});

it("rolls back Ticket edges, node archival, graph pointers and audits together on a storage failure", async () => {
  const f = await setup(); const { m, s } = await f.hierarchy();
  const draft = (await f.createTicket(s.id)).data.tickets[0];
  await f.call("approve_ticket_revision", { ticket_revision_id: draft.revision.id });
  const before = f.counts(); const base = f.base(); const edges = f.ports.graphEdges.list(f.project.id, "active");
  f.database.exec("CREATE TRIGGER reject_planning_archive BEFORE UPDATE ON graph_nodes WHEN NEW.lifecycle_status = 'archived' BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;");
  const failed = await f.call("save_planning_node", { project_id: f.project.id, base_graph_revision_id: base,
    change: { operation: "archive", node_id: m.id } });
  expect(failed.ok).toBe(false);
  expect(f.counts()).toEqual(before); expect(f.base()).toBe(base);
  expect(f.ports.graphEdges.list(f.project.id, "active")).toEqual(edges);
  expect(f.ports.graphNodes.findById(s.id)?.lifecycleStatus).toBe("active");
});

it("reparents Spec with stable identity, updates its edge and does not silently rewrite old Ticket ancestry", async () => {
  const f = await setup(); const { m, s } = await f.hierarchy();
  const other = (await f.save({ ...milestone, content: { ...milestone.content, sequence: 2 } }, undefined, undefined, "Next phase")).data.node;
  const draft = (await f.createTicket(s.id)).data.tickets[0];
  await f.call("approve_ticket_revision", { ticket_revision_id: draft.revision.id });
  const moved = await f.save(spec, other.id, s.id);
  expect(moved.data.node.id).toBe(s.id);
  expect(moved.data.planning.affected_ticket_ids).toContain(draft.ticket.id);
  expect(f.ports.graphEdges.list(f.project.id, "active").filter(e => e.sourceNodeId === s.id).map(e => e.targetNodeId)).toEqual([other.id]);
  expect(f.ports.ticketRevisions.findById(draft.revision.id)?.specification.related_graph_node_ids).toContain(m.id);
});

it("protects planning ownership from legacy graph mutation and allows equal display titles", async () => {
  const f = await setup(); const { m } = await f.hierarchy();
  expect((await f.save(milestone)).ok).toBe(true);
  const draft = f.service.createGraphDraftBatch({ projectId: f.project.id, baseGraphRevisionId: f.base(),
    sourceProductBriefVersionId: f.brief.version.id, changes: [{ changeId: "bad", operation: "update", entityKind: "node", targetId: m.id, payload: { title: "Bypass" } }] });
  expect(draft.validation.conflicts).not.toHaveLength(0);
  expect(() => f.service.approveGraphDraftBatch(draft.graphDraftBatch.id)).toThrow();
});

it("retains the hierarchy, exact Spec content and revision history after reopening SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apg-planning-")); const path = join(dir, "project.sqlite");
  try {
    const f = await setup(path); const { m, s } = await f.hierarchy();
    await f.save({ ...spec, content: { ...spec.content, solution: "修訂方案" } }, m.id, s.id);
    const before = f.counts(); await f.close();
    const database = openDatabase(path);
    try {
      const ports = createSqlitePorts(database);
      expect(ports.graphNodes.findById(s.id)?.metadata.content).toMatchObject({ solution: "修訂方案" });
      expect(database.prepare("SELECT count(*) AS n FROM graph_revisions").get()).toEqual(before.graph_revisions);
      const changes = database.prepare("SELECT payload_json FROM graph_draft_batch_changes WHERE operation = 'add'").all();
      expect(JSON.stringify(changes)).toContain(spec.content.solution);
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally { database.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("does not let automatic root reconciliation silently validate a legacy Ticket without Spec ancestry", () => {
  const f = acceptanceFixture();
  try {
    f.service.planning.syncBrief(f.project.id);
    expect(f.service.planning.inspect(f.project.id).affectedTicketIds).toContain(f.ticket.id);
    expect(() => f.service.getImplementationHandoff({ implementationBriefId: f.briefs[0]!.id,
      currentRepositoryState: { commitSha: "abc123" } })).toThrow(expect.objectContaining({
        code: "STALE_HANDOFF", details: expect.objectContaining({ reason: "planning_source_missing" })
      }));
    expect(f.ports.ticketRevisions.findById(f.revision.id)?.specification.source_spec_id).toBeUndefined();
  } finally { f.database.close(); }
});

async function deliver(f: Awaited<ReturnType<typeof setup>>, specId: string) {
  const draft = (await f.createTicket(specId)).data.tickets[0];
  const approved = (await f.call("approve_ticket_revision", { ticket_revision_id: draft.revision.id })).data;
  const brief = f.service.createImplementationBriefDraft({ implementationTargetId: approved.implementation_targets[0].id,
    repoContext: { repositoryName: "Timer", summary: "Context", fileList: [], moduleNotes: [], baselineCommitSha: "abc", hasUncommittedChanges: false },
    brief: { implementationPlan: ["Controls"], suggestedFilesToInspect: [], testStrategy: ["Behavior"], risks: [], prSummaryDraft: "Controls" } }).implementationBrief;
  expect((await f.call("start_implementation", { implementation_brief_id: brief.id,
    current_repository_state: { commit_sha: "abc" } })).ok).toBe(true);
  const result = await f.call("submit_work_result", { implementation_brief_id: brief.id, summary: "Verified", unfinished_items: [],
    evidence: [{ ref: "behavior", evidence_type: "test_execution", idempotency_key: `behavior-${draft.ticket.id}`,
      payload: { schema_version: 1, command: "fixture behavior check", status: "passed", exit_code: 0,
        started_at: "2026-09-28T00:00:00.000Z", completed_at: "2026-09-28T00:01:00.000Z" } }],
    criterion_verdicts: approved.revision.specification.acceptance_criteria.map((criterion: { id: string }) => ({
      acceptance_criterion_id: criterion.id, verdict: "satisfied", reason: "Fixture behavior verified", evidence_refs: ["behavior"]
    })) });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { ticket: draft.ticket, revision: approved.revision, brief, result: result.data.implementation_result };
}

it.each([false, true])("preserves pending and accepted delivery across sibling expansion (already accepted: %s)", async acceptedBefore => {
  const f = await setup(); const { m, s } = await f.hierarchy();
  const work = await deliver(f, s.id);
  const accept = () => f.call("accept_implementation_result", {
    implementation_result_id: work.result.id, idempotency_key: "accept-unchanged-controls"
  });
  const originalAcceptance = acceptedBefore ? await accept() : null;
  if (originalAcceptance) expect(originalAcceptance.ok).toBe(true);
  const artifactCounts = () => ["ticket_revisions", "implementation_briefs", "implementation_results", "observed_evidence"]
    .map(table => f.database.prepare(`SELECT count(*) AS n FROM ${table}`).get());
  const before = artifactCounts();
  const updated = f.service.createProductBriefDraft({ projectId: f.project.id, sourceIdeaId: f.idea.id,
    baseApprovedVersionId: f.brief.version.id, brief: { ...f.brief.version.brief, mvp_scope: ["計時", "戰績"] } });
  f.service.approveProductBriefVersion(updated.version.id);
  expect(f.service.planning.inspect(f.project.id).affectedTicketIds).toContain(work.ticket.id);
  if (!acceptedBefore) expect((await accept()).ok).toBe(false);
  const expanded = { ...milestone, content: { ...milestone.content, scope: ["單一模式", "戰績"] } };
  await f.save(expanded, undefined, m.id);
  expect((await f.save({ ...spec, content: { ...spec.content, solution: "累計戰績" } }, m.id, undefined, "戰績")).ok).toBe(true);
  expect(f.service.planning.inspect(f.project.id).affectedTicketIds).toContain(work.ticket.id);
  expect((await f.save(spec, m.id, s.id)).ok).toBe(true);
  expect(f.service.planning.inspect(f.project.id).affectedTicketIds).toEqual([]);
  expect(artifactCounts()).toEqual(before);
  const accepted = await accept();
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  if (originalAcceptance) expect(accepted.data).toEqual(originalAcceptance.data);
  expect(f.ports.tickets.findById(work.ticket.id)).toMatchObject({ deliveryStatus: "done", currentApprovedRevisionId: work.revision.id });
  expect(f.ports.implementationResults.findById(work.result.id)).toMatchObject({ lifecycleStatus: "active", reviewStatus: "approved" });
  expect(f.ports.implementationBriefs.findById(work.brief.id)?.lifecycleStatus).toBe("active");
  const graph = (await f.call("get_graph_context", { project_id: f.project.id })).data;
  expect(graph.delivery.summary).toMatchObject({ done: 1, stale: 0, awaiting_acceptance: 0 });
  expect(graph.delivery.tickets[0].next_action).toBe("done");
  expect(f.database.prepare("SELECT count(*) AS n FROM result_acceptances").get()).toEqual({ n: 1 });
});

it("keeps identical saves current, but real Spec edits and later reversions require a replacement revision", async () => {
  const f = await setup(); const { m, s } = await f.hierarchy(); const work = await deliver(f, s.id);
  const same = await f.save(spec, m.id, s.id);
  expect(same.data.graph_revision.id).not.toBe(s.metadata.content_revision_id);
  expect(same.data.node.metadata.content_revision_id).toBe(s.metadata.content_revision_id);
  expect(same.data.planning.affected_ticket_ids).toEqual([]);
  const changed = await f.save({ ...spec, content: { ...spec.content, solution: "改成倒數計時" } }, m.id, s.id);
  expect(changed.data.node.metadata.content_revision_id).toBe(changed.data.graph_revision.id);
  expect(changed.data.planning.affected_ticket_ids).toEqual([work.ticket.id]);
  const reverted = await f.save(spec, m.id, s.id);
  expect(reverted.data.planning.affected_ticket_ids).toEqual([work.ticket.id]);
  expect((await f.call("start_implementation", { implementation_brief_id: work.brief.id,
    current_repository_state: { commit_sha: "abc" } })).error.code).toBe("STALE_HANDOFF");
  expect((await f.call("accept_implementation_result", { implementation_result_id: work.result.id, idempotency_key: "old-content" })).ok).toBe(false);
  const replacement = await f.call("create_ticket_revision_draft", { ticket_id: work.ticket.id,
    base_approved_revision_id: work.revision.id, source_graph_revision_id: f.base(), specification: f.ticketInput(s.id) });
  expect((await f.call("approve_ticket_revision", { ticket_revision_id: replacement.data.revision.id })).ok).toBe(true);
  expect(f.ports.implementationBriefs.findById(work.brief.id)?.lifecycleStatus).toBe("archived");
  expect(f.ports.implementationResults.findById(work.result.id)?.lifecycleStatus).toBe("archived");
});

it("uses the last known source revision for legacy planning nodes without guessing historical equivalence", async () => {
  const f = await setup(); const { m, s } = await f.hierarchy();
  f.database.prepare("UPDATE graph_nodes SET metadata_json = json_remove(metadata_json, '$.content_revision_id') WHERE id IN (?, ?)").run(m.id, s.id);
  const work = await deliver(f, s.id);
  const original = f.ports.graphNodes.findById(s.id)!.lastChangedInGraphRevisionId;
  expect((await f.save(spec, m.id, s.id)).data.node.metadata.content_revision_id).toBe(original);
  expect(f.service.planning.inspect(f.project.id).affectedTicketIds).toEqual([]);
  expect((await f.call("start_implementation", { implementation_brief_id: work.brief.id,
    current_repository_state: { commit_sha: "abc" } })).data.freshness).toBe("current");
});

it.each(["reference", "dependency"])("still invalidates a sibling Ticket with an explicit %s on changed work", async relation => {
  const f = await setup(); const { m, s } = await f.hierarchy(); const work = await deliver(f, s.id);
  const sibling = (await f.save({ ...spec, content: { ...spec.content, solution: "記錄戰績" } }, m.id, undefined, "戰績")).data.node;
  const draft = await f.call("create_ticket_draft_batch", { project_id: f.project.id, source_graph_revision_id: f.base(),
    source_node_ids: [sibling.id], tickets: [{ ...f.ticketInput(sibling.id), title: "戰績",
      related_graph_node_ids: relation === "reference" ? [s.id] : [], dependencies: relation === "dependency" ? [work.ticket.id] : [] }] });
  expect(draft.ok, JSON.stringify(draft)).toBe(true);
  const dependent = draft.data.tickets[0];
  expect((await f.call("approve_ticket_revision", { ticket_revision_id: dependent.revision.id })).ok).toBe(true);
  await f.save({ ...spec, content: { ...spec.content, solution: "新單局規則" } }, m.id, s.id);
  expect(f.service.planning.inspect(f.project.id).affectedTicketIds.sort()).toEqual([work.ticket.id, dependent.ticket.id].sort());
  const delivery = (await f.call("get_work_context", { ticket_id: dependent.ticket.id })).data.delivery;
  expect(delivery.next_action).toBe("reconcile_sources");
  expect(delivery.source_problem.reason).toBe(relation === "reference" ? "graph_node_changed" : "ticket_dependency_stale");
});
