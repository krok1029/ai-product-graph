import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it } from "vitest";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createMcpServer } from "./server.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function setup(profile?: "core" | "full", targetCount = 1) {
  const f = acceptanceFixture(targetCount);
  const server = createMcpServer(f.service, { profile });
  const client = new Client({ name: "local-workflow", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  cleanups.push(async () => { await client.close(); await server.close(); f.database.close(); });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return (result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>)[0]!.text)) as { ok: boolean; data: any; error?: { code: string } };
  };
  return { ...f, client, call };
}

it("defaults to 23 local tools without legacy prompts or external sync surfaces", async () => {
  const f = await setup();
  const names = (await f.client.listTools()).tools.map(tool => tool.name);
  expect(names).toHaveLength(23);
  expect(names).toEqual(expect.arrayContaining(["get_work_context", "start_implementation", "submit_work_result"]));
  expect(names).not.toEqual(expect.arrayContaining(["register_external_container"]));
  for (const name of ["request_plane_ticket_export", "get_mapping_sync_health", "approve_implementation_brief", "record_observed_evidence", "submit_implementation_result"]) {
    expect(names).not.toContain(name);
    expect((await f.client.callTool({ name, arguments: {} })).isError).toBe(true);
  }
  expect(f.client.getServerCapabilities()?.prompts).toBeUndefined();
  expect((await f.client.listResourceTemplates()).resourceTemplates.map(resource => resource.uriTemplate)
    .some(uri => /external-work|sync-health|sync-plan/.test(uri))).toBe(false);
});

it("retains the original tools and six prompts in full compatibility mode", async () => {
  const f = await setup("full");
  expect((await f.client.listTools()).tools).toHaveLength(45);
  expect((await f.client.listPrompts()).prompts).toHaveLength(6);
  expect((await f.call("list_external_containers", {})).ok).toBe(true);
});

it("reads the Ticket, current product intent and repository targets without durable writes", async () => {
  const f = await setup(undefined, 2);
  const before = f.database.prepare("SELECT total_changes() AS n").get();
  const result = await f.call("get_work_context", { ticket_id: f.ticket.id });
  expect(result.data.revision.id).toBe(f.revision.id);
  expect(result.data.product_brief_version.id).toBe(f.productBrief.version.id);
  expect(result.data.targets).toHaveLength(2);
  expect(result.data.targets.map((entry: any) => entry.approved_brief.id).sort()).toEqual(f.briefs.map(brief => brief.id).sort());
  expect(f.database.prepare("SELECT total_changes() AS n").get()).toEqual(before);
  expect((await f.call("get_work_context", { ticket_id: "missing" })).error?.code).toBe("NOT_FOUND");
});

function draft(f: Awaited<ReturnType<typeof setup>>) {
  const source = f.briefs[0]!;
  const target = f.ports.implementationTargets.findById(source.implementationTargetId)!;
  const repository = f.ports.repositories.findById(target.repositoryId)!;
  return f.service.createImplementationBriefDraft({
    implementationTargetId: target.id, supersedesImplementationBriefId: source.id,
    repoContext: { repositoryName: repository.name, summary: "Current context", fileList: [], moduleNotes: [], baselineCommitSha: "abc123", hasUncommittedChanges: false },
    brief: { implementationPlan: ["Implement controls"], suggestedFilesToInspect: [], testStrategy: ["Verify"], risks: [], prSummaryDraft: "Controls" }
  }).implementationBrief;
}

it("approves and validates the exact draft once, and revalidates an already approved brief", async () => {
  const f = await setup();
  const candidate = draft(f);
  const command = { implementation_brief_id: candidate.id, current_repository_state: { commit_sha: "abc123" } };
  const result = await f.call("start_implementation", command);
  expect(result.data.freshness).toBe("current");
  expect(result.data.implementation_brief.review_status).toBe("approved");
  expect(f.ports.implementationBriefs.findById(candidate.id)?.approvedByActorId).toBe("acceptance-user");
  expect((await f.call("start_implementation", command)).data.implementation_brief).toEqual(result.data.implementation_brief);
  expect(f.ports.auditLog.list().filter(a => a.action === "implementation_brief.approved" && a.entityId === candidate.id)).toHaveLength(1);
});

it("rolls back approval and predecessor archival on stale repository state while auditing the block", async () => {
  const f = await setup();
  const candidate = draft(f);
  const result = await f.call("start_implementation", {
    implementation_brief_id: candidate.id, current_repository_state: { commit_sha: "changed" }
  });
  expect(result.error?.code).toBe("STALE_HANDOFF");
  expect(f.ports.implementationBriefs.findById(candidate.id)?.reviewStatus).toBe("draft");
  expect(f.ports.implementationBriefs.findById(f.briefs[0]!.id)?.lifecycleStatus).toBe("active");
  expect(f.ports.auditLog.list().filter(a => a.entityId === candidate.id && a.action === "implementation_handoff.blocked")).toHaveLength(1);
});

function submission(f: Awaited<ReturnType<typeof setup>>, count = 4) {
  return {
    implementation_brief_id: f.briefs[0]!.id, summary: "Controls verified", unfinished_items: [],
    evidence: Array.from({ length: count }, (_, n) => ({
      ref: `test-${n}`, evidence_type: "test_execution", idempotency_key: `test-${n}`,
      payload: { schema_version: 1, command: `controls-check-${n}`, status: "passed", exit_code: 0,
        started_at: "2026-09-27T00:00:00.000Z", completed_at: "2026-09-27T00:01:00.000Z" }
    })),
    criterion_verdicts: f.revision.specification.acceptance_criteria.map(criterion => ({
      acceptance_criterion_id: criterion.id, verdict: "satisfied", reason: "Controls check verifies this condition.", evidence_refs: ["test-0"]
    }))
  };
}

it("submits four evidence records and a draft in one call, then requires a separate user acceptance", async () => {
  const f = await setup();
  const result = await f.call("submit_work_result", submission(f));
  expect(result.ok).toBe(true);
  expect(result.data.observed_evidence_ids).toHaveLength(4);
  expect(result.data.implementation_result.review_status).toBe("draft");
  expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe("planned");
  const accepted = await f.call("accept_implementation_result", {
    implementation_result_id: result.data.implementation_result.id, idempotency_key: "accept-controls"
  });
  expect(accepted.data.ticket.delivery_status).toBe("done");
  expect(f.database.pragma("foreign_key_check")).toEqual([]);
});

it.each(["missing-ref", "duplicate-ref", "bad-payload", "bad-criterion"])("rolls back bundled evidence and audits for %s", async failure => {
  const f = await setup();
  const command = submission(f);
  if (failure === "missing-ref") command.criterion_verdicts[0]!.evidence_refs = ["missing"];
  if (failure === "duplicate-ref") command.evidence[1]!.ref = command.evidence[0]!.ref;
  if (failure === "bad-payload") command.evidence[1]!.payload.exit_code = 1;
  if (failure === "bad-criterion") command.criterion_verdicts[0]!.acceptance_criterion_id = "missing";
  const before = f.ports.auditLog.list();
  expect((await f.call("submit_work_result", command)).ok).toBe(false);
  expect(f.database.prepare("SELECT count(*) AS n FROM observed_evidence").get()).toEqual({ n: 0 });
  expect(f.database.prepare("SELECT count(*) AS n FROM implementation_results").get()).toEqual({ n: 0 });
  expect(f.ports.auditLog.list()).toEqual(before);
});

it("preserves stale observations as archived Results and rejects acceptance", async () => {
  const f = await setup();
  f.ports.implementationTargets.archive(f.briefs[0]!.implementationTargetId, "2026-09-27T01:00:00Z");
  const result = await f.call("submit_work_result", submission(f));
  expect(result.data.implementation_result).toMatchObject({ lifecycle_status: "archived", stale_at_submission: true });
  expect(result.data.observed_evidence_ids).toHaveLength(4);
  expect((await f.call("accept_implementation_result", {
    implementation_result_id: result.data.implementation_result.id, idempotency_key: "stale"
  })).ok).toBe(false);
});

it("shows evidence gaps, pending results and acceptance per target without changing delivery records", async () => {
  const f = await setup(undefined, 2);
  const read = async () => {
    const before = f.database.prepare("SELECT total_changes() AS n").get();
    const graph = (await f.call("get_graph_context", { project_id: f.project.id })).data;
    const work = (await f.call("get_work_context", { ticket_id: f.ticket.id })).data;
    expect(f.database.prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect(graph.delivery.tickets[0]).toEqual(work.delivery);
    return { graph, work, delivery: work.delivery };
  };
  let state = await read();
  expect(state.delivery.next_action).toBe("implement");
  expect(state.delivery.targets.every((target: any) => target.criteria_without_evidence.length === 3)).toBe(true);
  const incomplete = f.submit(0, [1], false).implementationResult;
  state = await read();
  expect(state.work.targets.find((target: any) => target.target.id === f.briefs[0]!.implementationTargetId).pending_result.id).toBe(incomplete.id);
  expect(state.delivery.targets.find((target: any) => target.implementation_target_id === f.briefs[0]!.implementationTargetId)).toMatchObject({ pending_result_id: incomplete.id,
    criteria_without_evidence: f.revision.specification.acceptance_criteria.map(criterion => criterion.id),
    unsatisfied_criterion_ids: [f.revision.specification.acceptance_criteria[1]!.id] });
  const first = f.submit(0).implementationResult;
  state = await read();
  expect(state.delivery.targets.find((target: any) => target.implementation_target_id === f.briefs[0]!.implementationTargetId)).toMatchObject({ pending_result_id: first.id, criteria_without_evidence: [], unsatisfied_criterion_ids: [] });
  expect(state.delivery.next_action).toBe("review_result");
  expect(state.graph.delivery.summary).toMatchObject({ total: 1, done: 0, awaiting_acceptance: 1 });
  expect((await f.call("accept_implementation_result", { implementation_result_id: first.id, idempotency_key: "first-target" })).ok).toBe(true);
  state = await read();
  expect(state.delivery.targets.find((target: any) => target.implementation_target_id === f.briefs[0]!.implementationTargetId)).toMatchObject({ accepted_result_id: first.id, pending_result_id: null, criteria_without_evidence: [] });
  expect(state.delivery.next_action).toBe("implement");
  expect(state.graph.delivery.summary.done).toBe(0);
  const second = f.submit(1).implementationResult;
  await f.call("accept_implementation_result", { implementation_result_id: second.id, idempotency_key: "second-target" });
  state = await read();
  expect(state.delivery.next_action).toBe("done");
  expect(state.graph.delivery.summary).toMatchObject({ done: 1, awaiting_acceptance: 0 });
  const correction = f.submit(0, [1], false, first.id).implementationResult;
  state = await read();
  expect(state.delivery.next_action).toBe("review_result");
  expect(state.delivery.targets.find((target: any) => target.implementation_target_id === f.briefs[0]!.implementationTargetId))
    .toMatchObject({ accepted_result_id: first.id, pending_result_id: correction.id,
      criteria_without_evidence: f.revision.specification.acceptance_criteria.map(criterion => criterion.id) });
});

it("distinguishes dependency blockers, completed work and later product intent changes", async () => {
  const f = await setup();
  const dependent = f.service.createTicketDraftBatch({ projectId: f.project.id, sourceGraphRevisionId: f.graph.graphRevision.id,
    sourceNodeIds: [f.goal], tickets: [{ title: "Dependent feature", userStory: "Use the delivered controls", scope: ["Dependent"],
      acceptanceCriteria: ["Dependent works"], nonGoals: [], relatedGraphNodeIds: [f.goal], dependencies: [f.ticket.id],
      implementationTargets: [{ repositoryId: f.ports.implementationTargets.findById(f.briefs[0]!.implementationTargetId)!.repositoryId,
        scope: ["Dependent"] }], implementationNotes: [] }] }).tickets[0]!;
  const graph = () => f.call("get_graph_context", { project_id: f.project.id });
  let delivery = (await graph()).data.delivery;
  expect(delivery.tickets.find((ticket: any) => ticket.ticket_id === dependent.ticket.id).next_action).toBe("approve_ticket");
  f.service.approveTicketRevision(dependent.revision.id);
  delivery = (await graph()).data.delivery;
  expect(delivery.summary.blocked).toBe(1);
  expect(delivery.tickets.find((ticket: any) => ticket.ticket_id === dependent.ticket.id)).toMatchObject({
    next_action: "complete_dependencies", blocking_dependency_ids: [f.ticket.id], source_freshness: "current"
  });
  const result = f.submit().implementationResult;
  await f.call("accept_implementation_result", { implementation_result_id: result.id, idempotency_key: "dependency-done" });
  delivery = (await graph()).data.delivery;
  expect(delivery.summary).toMatchObject({ blocked: 0, done: 1 });
  expect(delivery.tickets.find((ticket: any) => ticket.ticket_id === dependent.ticket.id).next_action).toBe("implement");
  // 未採用階層的舊專案仍需顯示尚未 reconciliation 的產品意圖。
  const nextBrief = f.service.createProductBriefDraft({ projectId: f.project.id, sourceIdeaId: f.idea.id,
    baseApprovedVersionId: f.productBrief.version.id, brief: { ...f.productBrief.version.brief, product_goal: "Changed" } });
  f.service.approveProductBriefVersion(nextBrief.version.id);
  delivery = (await graph()).data.delivery;
  expect(delivery.summary.stale).toBe(2);
  expect(delivery.tickets.every((ticket: any) => ticket.next_action === "reconcile_sources" &&
    ticket.source_problem.reason === "product_intent_unreconciled")).toBe(true);
  expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe("done");
});
