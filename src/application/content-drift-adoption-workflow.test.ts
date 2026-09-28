// 真實 SQLite 驗證 draft 與處置的原子性，不連線外部 provider。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { contentDriftAdoptionFixture } from "../test-support/content-drift-adoption-fixture.js";
import { ProductGraphService } from "./product-graph-service.js";
import { readContentDriftResolution } from "./content-drift-resolution-support.js";
import { evaluateTicketSourceFreshness } from "./implementation-freshness.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";

let f: Awaited<ReturnType<typeof contentDriftAdoptionFixture>>;
const directories: string[] = [];
beforeEach(async () => { f = await contentDriftAdoptionFixture(); });
afterEach(() => { f.database.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

it("creates a normal normalized draft with one frozen event and no mutation to delivery or exact mixed evidence", () => {
  const captured = f.capture({ content: { name: "External <title>", description_html: '<div onclick="evil()"><script>evil()</script><p> &amp; 複雜原文</p></div>', external_source: "untrusted" },
    changes: [{ field: "name", expected: "Deliver feature", observed: { present: true, value: "External <title>" } },
      { field: "external_source", expected: "ai-product-graph", observed: { present: true, value: "untrusted" } }] });
  const before = f.allRows();
  const calls = f.clockCalls();
  const target = f.service;

  const result = target.adoptContentDrift(f.command(captured.drift!.id));

  expect(f.clockCalls()).toBe(calls + 1);
  expect(result.resolution.draft).toMatchObject({ ticketId: f.ticket.id, title: "Editorial title", revisionNumber: 2,
    baseApprovedRevisionId: f.revision.id, sourceGraphRevisionId: f.currentGraph(), reviewStatus: "draft", lifecycleStatus: "active",
    specification: { user_story: "Selected external wording", scope: ["Feature"], acceptance_criteria: [{ text: "Works" }] } });
  expect(result.resolution.draft.specification).toEqual({ traces_to_ticket_id: null,
    user_story: "Selected external wording", scope: ["Feature"],
    acceptance_criteria: [{ id: `${f.ticket.id}:r2:ac1`, text: "Works" }], non_goals: [],
    related_graph_node_ids: [f.goal], dependencies: [], implementation_notes: [] });
  expect(result.resolution.decision).toMatchObject({ decisionType: "content_drift_adoption", summary: "採用選定文字", actorId: "acceptance-user" });
  expect(result.resolution.record).toMatchObject({ kind: "adopt", draftTicketRevisionId: result.resolution.draft.id });
  expect(result.proposedImplementationTargets).toEqual([{ implementationTargetId: f.briefs[0]!.implementationTargetId,
    repositoryId: f.revision.requiredTargets[0]!.repository_id, scope: ["Feature"], identityAction: "reuse" }]);
  const audits = f.ports.auditLog.list().filter(row => row.id === result.auditLogId || row.entityId === result.resolution.draft.id);
  expect(audits.map(row => row.action).sort()).toEqual(["content_drift.adopted", "ticket_revision.draft_created"]);
  expect(audits.every(row => row.createdAt === result.resolution.decision.createdAt && row.createdAt === result.resolution.draft.createdAt)).toBe(true);
  expect(audits.find(row => row.id === result.auditLogId)!.afterSummary).toMatchObject({
    capturedSourceTicketRevisionId: f.revision.id, baseApprovedRevisionId: f.revision.id, draftTicketRevisionId: result.resolution.draft.id });
  for (const table of ["projects", "graph_nodes", "graph_edges", "tickets", "implementation_targets", "implementation_briefs",
    "implementation_results", "external_work_item_mappings", "sync_intents", "external_work_item_snapshots", "content_drifts"]) {
    expect(f.allRows()[table], table).toEqual(before[table]);
  }
  expect(readContentDriftResolution(f.ports, captured.drift!.id)).toEqual({ evidence: result.evidence, resolution: result.resolution });
  expect(result.evidence.snapshot).toEqual(captured.snapshot);
});

it("preserves captured revision independently from latest explicit adoption base and normal later enrollment", () => {
  const captured = f.capture();
  const latest = f.replaceRevision();
  const result = f.service.adoptContentDrift(f.command(captured.drift!.id));
  expect(result.evidence.observation.sourceTicketRevisionId).toBe(f.revision.id);
  expect(result.resolution.draft.baseApprovedRevisionId).toBe(latest.id);
  const approved = f.service.approveTicketRevision(result.resolution.draft.id);
  expect(approved.createdSyncIntentIds).toHaveLength(1);
  expect(approved.ticket.deliveryStatus).toBe("planned");
  expect(approved.syncHealth).toBe("pending");
  const view = readContentDriftResolution(f.ports, captured.drift!.id);
  expect(view.resolution!.decision).toEqual(result.resolution.decision);
  expect(view.resolution!.draft!.reviewStatus).toBe("approved");
  expect(f.ports.planeObservationReads.readDrift(captured.drift!.id)!.drift.resolutionDecisionId).toBeNull();
});

it("normal competing approval archives the candidate without altering its historical Decision", () => {
  const captured = f.capture();
  const adopted = f.service.adoptContentDrift(f.command(captured.drift!.id));
  f.replaceRevision();
  const before = f.allRows();
  expect(() => f.service.approveTicketRevision(adopted.resolution.draft.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
  expect(readContentDriftResolution(f.ports, captured.drift!.id).resolution).toMatchObject({
    decision: adopted.resolution.decision, draft: { lifecycleStatus: "archived", reviewStatus: "draft" } });
});

it.each(["repeat", "reject-first", "reject-after"])("prevents a second resolution for %s", scenario => {
  const captured = f.capture();
  const first = scenario === "reject-first" ? f.service.rejectContentDrift({ contentDriftId: captured.drift!.id, reason: "Reject" })
    : f.service.adoptContentDrift(f.command(captured.drift!.id));
  const before = f.allRows();
  const target = new ProductGraphService(f.ports, { actor: { id: "other", displayName: "Other" } });
  expect(() => scenario === "reject-after" ? target.rejectContentDrift({ contentDriftId: captured.drift!.id, reason: "Reject" })
    : target.adoptContentDrift(f.command(captured.drift!.id))).toThrow(expect.objectContaining({ code: "CONFLICT",
      details: { resolution_id: first.resolution.record.id, decision_id: first.resolution.decision.id } }));
  expect(f.allRows()).toEqual(before);
});

it("rejects marker-only changes with a precise reason and zero writes", () => {
  const captured = f.capture({ changes: [{ field: "external_source", expected: "other", observed: { present: true, value: "ai-product-graph" } }] });
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift(f.command(captured.drift!.id))).toThrow(expect.objectContaining({
    code: "CONFLICT", details: { content_drift_id: captured.drift!.id, reason: "no_saved_specification_change" } }));
  expect(f.allRows()).toEqual(before);
});

it("allows terminated historical mapping without reviving it or enrolling new outbound work", () => {
  const captured = f.capture();
  f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "Retired" });
  const before = f.allRows();
  const adopted = f.service.adoptContentDrift(f.command(captured.drift!.id));
  expect(adopted.resolution.record.kind).toBe("adopt");
  expect(f.allRows().external_work_item_mappings).toEqual(before.external_work_item_mappings);
  expect(f.service.approveTicketRevision(adopted.resolution.draft.id).createdSyncIntentIds).toEqual([]);
});

it.each(["draft-audit", "decision", "resolution-audit", "association"])("rolls back actor, draft, sources, dependencies and audits after %s failure", point => {
  const captured = f.capture();
  const table = point === "decision" ? "decisions" : point === "association" ? "content_drift_resolutions" : "audit_log";
  const when = point === "draft-audit" ? "WHEN NEW.action = 'ticket_revision.draft_created'" : point === "resolution-audit" ? "WHEN NEW.action = 'content_drift.adopted'" : "";
  f.database.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON ${table} ${when} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  const before = f.allRows();
  const target = new ProductGraphService(f.ports, { actor: { id: "new-actor", displayName: "Other" } });
  expect(() => target.adoptContentDrift(f.command(captured.drift!.id))).toThrow("injected failure");
  expect(f.allRows()).toEqual(before);
});

it.each([
  ["base", { baseApprovedRevisionId: "wrong" }], ["graph", { sourceGraphRevisionId: "wrong" }],
  ["empty reason", { reason: " " }], ["owner override", { ticketId: "wrong" }], ["actor override", { actorId: "wrong" }],
  ["empty specification", { specification: null }]
])("rejects invalid %s without partial writes", (_name, extra) => {
  const captured = f.capture();
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift({ ...f.command(captured.drift!.id), ...extra } as never)).toThrow();
  expect(f.allRows()).toEqual(before);
});

it.each([
  { title: " " }, { acceptanceCriteria: [] }, { dependencies: ["wrong"] }, { relatedGraphNodeIds: ["wrong"] },
  { implementationTargets: [{ repositoryId: "wrong", scope: [] }] }, { tracesToTicketId: "wrong" }
])("reuses ordinary candidate validation for %j", extra => {
  const captured = f.capture();
  const command = f.command(captured.drift!.id);
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift({ ...command, specification: { ...command.specification, ...extra } })).toThrow();
  expect(f.allRows()).toEqual(before);
});

it.each([
  "UPDATE projects SET lifecycle_status = 'archived'",
  "UPDATE tickets SET lifecycle_status = 'archived'",
  "UPDATE product_briefs SET lifecycle_status = 'archived'",
  "UPDATE projects SET last_reconciled_product_brief_version_id = NULL",
  "UPDATE projects SET product_intent_graph_revision_id = NULL",
  "UPDATE graph_revisions SET source_product_brief_version_id = 'wrong'",
  "UPDATE product_brief_versions SET review_status = 'draft'",
  "UPDATE product_brief_versions SET lifecycle_status = 'archived'"
])("guards adoption-only reconciliation against %s", sql => {
  const captured = f.capture();
  const command = f.command(captured.drift!.id);
  f.database.pragma("foreign_keys = OFF");
  f.database.exec(sql);
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift(command)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
});

it("leaves ordinary draft behavior unchanged while blocking pending legacy reconciliation", () => {
  const captured = f.capture();
  f.changeBrief();
  const command = f.command(captured.drift!.id);
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift(command)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
  expect(f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: command.baseApprovedRevisionId,
    sourceGraphRevisionId: command.sourceGraphRevisionId, specification: command.specification }).revision.reviewStatus).toBe("draft");
});

it("propagates unexpected storage failure and returns NOT_FOUND for absent drift", () => {
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift(f.command("missing"))).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  vi.spyOn(f.ports.planeObservationReads, "readDrift").mockImplementation(() => { throw new Error("disk failure"); });
  expect(() => f.service.adoptContentDrift(f.command("missing"))).toThrow("disk failure");
  expect(f.allRows()).toEqual(before);
});

it.each(["inherited", "explicit"])("uses %s Spec ancestry and permits repairing a stale previous Ticket", source => {
  const { milestone, spec } = f.hierarchy();
  const approved = f.attach(spec.node.id);
  const captured = f.capture({ revisionId: approved.id });
  f.service.planning.save({ projectId: f.project.id, nodeId: spec.node.id, parentNodeId: milestone.node.id,
    baseGraphRevisionId: f.currentGraph(), title: "Changed capability", document: f.specDocument });
  expect(evaluateTicketSourceFreshness(f.ports, f.ports.tickets.findById(f.ticket.id)!, approved)?.reason).toBe("graph_node_changed");
  const command = f.command(captured.drift!.id);
  command.specification = f.specification({ relatedGraphNodeIds: [], ...(source === "explicit" ? { sourceSpecId: spec.node.id } : {}) });
  const result = f.service.adoptContentDrift(command);
  expect(result.resolution.draft.specification.source_spec_id).toBe(spec.node.id);
  expect(result.resolution.draft.specification.related_graph_node_ids).toEqual([spec.node.id, milestone.node.id,
    f.ports.graphNodes.list(f.project.id, "active").find(node => node.type === "product_brief")!.id]);
  const repaired = f.service.approveTicketRevision(result.resolution.draft.id);
  expect(evaluateTicketSourceFreshness(f.ports, repaired.ticket, repaired.revision)).toBeNull();
});

it.each(["missing", "wrong-project", "archived-spec", "archived-milestone", "stale-ancestor"])("rejects candidate %s ancestry with current root pointers", scenario => {
  const { milestone, spec } = f.hierarchy();
  if (scenario !== "missing") f.attach(spec.node.id);
  const captured = f.capture({ revisionId: f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId! });
  if (scenario === "archived-spec" || scenario === "archived-milestone") f.service.planning.archive({ projectId: f.project.id,
    baseGraphRevisionId: f.currentGraph(), nodeId: scenario === "archived-spec" ? spec.node.id : milestone.node.id });
  if (scenario === "stale-ancestor") f.changeBrief();
  if (scenario === "wrong-project") {
    const other = f.service.createProject({ name: "Other" }).project;
    f.database.prepare("UPDATE graph_nodes SET project_id = ? WHERE id = ?").run(other.id, spec.node.id);
  }
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift(f.command(captured.drift!.id))).toThrow(expect.objectContaining({ code: scenario === "missing" ? "VALIDATION_ERROR" : "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
});

it("reconfirms unchanged ancestry without replacing delivery identities and still rejects old graph input", () => {
  const { milestone, spec } = f.hierarchy();
  const revision = f.attach(spec.node.id);
  const target = f.ports.implementationTargets.findActiveByTicketAndRepository(f.ticket.id, f.revision.requiredTargets[0]!.repository_id)!;
  const brief = f.service.createImplementationBriefDraft({ implementationTargetId: target.id,
    repoContext: { repositoryName: "Repository 0", summary: "Context", fileList: [], moduleNotes: [], baselineCommitSha: "abc123" },
    brief: { implementationPlan: ["Build"], suggestedFilesToInspect: [], testStrategy: ["Check"], risks: [], prSummaryDraft: "Feature" } });
  f.service.approveImplementationBrief(brief.implementationBrief.id);
  const result = f.service.localDelivery.submit({ implementationBriefId: brief.implementationBrief.id,
    summary: "Delivered", observedEvidenceIds: [], unfinishedItems: [], evidence: [{ ref: "test", evidenceType: "test_execution", idempotencyKey: "hierarchy-test", payload: {
      schema_version: 1, command: "test", status: "passed", exit_code: 0,
      started_at: "2026-09-27T00:00:00.000Z", completed_at: "2026-09-27T00:01:00.000Z" } }],
    criterionVerdicts: revision.specification.acceptance_criteria.map(ac => ({ acceptanceCriterionId: ac.id, verdict: "satisfied", reason: "Checked", evidenceRefs: ["test"], evidenceIds: [] })) });
  f.service.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept-hierarchy" });
  const captured = f.capture({ revisionId: revision.id });
  const stale = f.command(captured.drift!.id);
  const identities = f.allRows();
  const contentRevision = spec.node.metadata.content_revision_id;
  f.changeBrief();
  expect(() => f.service.adoptContentDrift(f.command(captured.drift!.id))).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  f.service.planning.save({ projectId: f.project.id, nodeId: milestone.node.id, baseGraphRevisionId: f.currentGraph(),
    title: "Stage", document: f.milestoneDocument });
  const reconfirmed = f.service.planning.save({ projectId: f.project.id, nodeId: spec.node.id, parentNodeId: milestone.node.id,
    baseGraphRevisionId: f.currentGraph(), title: "Spec", document: f.specDocument });
  expect(reconfirmed.node.metadata.content_revision_id).toBe(contentRevision);
  const before = f.allRows();
  expect(() => f.service.adoptContentDrift(stale)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
  f.service.adoptContentDrift(f.command(captured.drift!.id));
  for (const table of ["tickets", "implementation_briefs", "implementation_results", "result_acceptances", "implementation_targets"]) {
    expect(f.allRows()[table], table).toEqual(identities[table]);
  }
});

it("serializes competing adoption connections into exactly one draft and resolution", async () => {
  const captured = f.capture();
  const directory = mkdtempSync(join(tmpdir(), "drift-adoption-")); directories.push(directory);
  const path = join(directory, "db.sqlite"); await f.database.backup(path);
  const script = `import { openDatabase } from './src/infrastructure/sqlite/database.ts';
    import { createSqlitePorts } from './src/infrastructure/sqlite/repositories.ts';
    import { ProductGraphService } from './src/application/product-graph-service.ts';
    const db = openDatabase(process.argv[1]);
    try { const r = new ProductGraphService(createSqlitePorts(db)).adoptContentDrift(JSON.parse(process.argv[2]));
      console.log(JSON.stringify({id:r.resolution.record.id})); }
    catch(e) { console.log(JSON.stringify({code:e.code,details:e.details,message:e.message})); } finally { db.close(); }`;
  const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path, JSON.stringify(f.command(captured.drift!.id))]);
  const outcomes = (await Promise.all([run(), run()])).map(value => JSON.parse(value.stdout));
  expect(outcomes.filter(value => value.id)).toHaveLength(1);
  expect(["CONFLICT", "SQLITE_BUSY"]).toContain(outcomes.find(value => value.code).code);
  const db = openDatabase(path);
  try {
    const ports = createSqlitePorts(db);
    const resolved = readContentDriftResolution(ports, captured.drift!.id).resolution!;
    expect(db.prepare("SELECT COUNT(*) AS count FROM ticket_revisions").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM decisions WHERE decision_type = 'content_drift_adoption'").get()).toEqual({ count: 1 });
    expect(() => new ProductGraphService(ports).adoptContentDrift(f.command(captured.drift!.id)))
      .toThrow(expect.objectContaining({ code: "CONFLICT", details: expect.objectContaining({ resolution_id: resolved.record.id }) }));
  } finally { db.close(); }
});

it("reuses normal lineage defaults and creates required-target identities only on later approval", () => {
  const related = f.service.createTicketDraftBatch({ projectId: f.project.id, sourceGraphRevisionId: f.currentGraph(), sourceNodeIds: [f.goal],
    tickets: [f.specification({ title: "Related Ticket" })] }).tickets[0]!;
  f.service.approveTicketRevision(related.revision.id);
  const traced = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
    sourceGraphRevisionId: f.currentGraph(), specification: f.specification({ tracesToTicketId: related.ticket.id }) });
  const approved = f.service.approveTicketRevision(traced.revision.id);
  const captured = f.capture({ revisionId: approved.revision.id });
  const extraRepo = f.service.createRepository({ projectId: f.project.id, slug: "extra", name: "Extra" }).repository;
  const command = f.command(captured.drift!.id);
  command.specification.implementationTargets.push({ repositoryId: extraRepo.id, scope: ["Extra target"] });
  command.specification.dependencies = [related.ticket.id];
  const before = f.allRows();

  const adopted = f.service.adoptContentDrift(command);

  expect(adopted.resolution.draft.specification.traces_to_ticket_id).toBe(related.ticket.id);
  expect(adopted.resolution.draft.specification.dependencies).toEqual([related.ticket.id]);
  expect(adopted.proposedImplementationTargets[1]).toEqual({ implementationTargetId: null, repositoryId: extraRepo.id,
    scope: ["Extra target"], identityAction: "create_on_approval" });
  expect(f.allRows().implementation_targets).toEqual(before.implementation_targets);
  expect(f.allRows().graph_edges).toEqual(before.graph_edges);
  expect(f.service.approveTicketRevision(adopted.resolution.draft.id).implementationTargets.targets).toHaveLength(2);
});

it("allows moving a Spec to a reconciled parent and repairing its old Ticket through an explicit candidate", () => {
  const { spec } = f.hierarchy();
  const approved = f.attach(spec.node.id);
  const captured = f.capture({ revisionId: approved.id });
  const other = f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: f.currentGraph(), title: "Other stage", document: f.milestoneDocument });
  f.service.planning.save({ projectId: f.project.id, nodeId: spec.node.id, parentNodeId: other.node.id,
    baseGraphRevisionId: f.currentGraph(), title: "Spec", document: f.specDocument });
  expect(evaluateTicketSourceFreshness(f.ports, f.ports.tickets.findById(f.ticket.id)!, approved)).not.toBeNull();
  const command = f.command(captured.drift!.id);
  command.specification = f.specification({ sourceSpecId: spec.node.id, relatedGraphNodeIds: [] });
  const adopted = f.service.adoptContentDrift(command);
  expect(adopted.resolution.draft.specification.related_graph_node_ids).toContain(other.node.id);
  expect(f.service.approveTicketRevision(adopted.resolution.draft.id).revision.reviewStatus).toBe("approved");
});

it("keeps normal handoff and Acceptance source checks after adoption and later upstream change", () => {
  const { milestone, spec } = f.hierarchy();
  const revision = f.attach(spec.node.id);
  const captured = f.capture({ revisionId: revision.id });
  const adopted = f.service.adoptContentDrift(f.command(captured.drift!.id));
  const approved = f.service.approveTicketRevision(adopted.resolution.draft.id);
  const brief = f.service.createImplementationBriefDraft({ implementationTargetId: approved.implementationTargets.targets[0]!.id,
    repoContext: { repositoryName: "Repository 0", summary: "Context", fileList: [], moduleNotes: [], baselineCommitSha: "abc123" },
    brief: { implementationPlan: ["Build"], suggestedFilesToInspect: [], testStrategy: ["Check"], risks: [], prSummaryDraft: "Feature" } });
  f.service.approveImplementationBrief(brief.implementationBrief.id);
  expect(f.service.getImplementationHandoff({ implementationBriefId: brief.implementationBrief.id,
    currentRepositoryState: { commitSha: "abc123" } }).freshness).toBe("current");
  const result = f.service.localDelivery.submit({ implementationBriefId: brief.implementationBrief.id,
    summary: "Delivered", observedEvidenceIds: [], unfinishedItems: [], evidence: [{ ref: "test", evidenceType: "test_execution",
      idempotencyKey: "new-delivery", payload: { schema_version: 1, command: "test", status: "passed", exit_code: 0,
        started_at: "2026-09-27T00:00:00.000Z", completed_at: "2026-09-27T00:01:00.000Z" } }],
    criterionVerdicts: approved.revision.specification.acceptance_criteria.map(ac => ({ acceptanceCriterionId: ac.id,
      verdict: "satisfied", reason: "Checked", evidenceRefs: ["test"], evidenceIds: [] })) });
  f.service.planning.save({ projectId: f.project.id, nodeId: spec.node.id, parentNodeId: milestone.node.id,
    baseGraphRevisionId: f.currentGraph(), title: "Changed requirements", document: f.specDocument });
  expect(() => f.service.getImplementationHandoff({ implementationBriefId: brief.implementationBrief.id,
    currentRepositoryState: { commitSha: "abc123" } })).toThrow(expect.objectContaining({ code: "STALE_HANDOFF" }));
  const before = f.allRows();
  expect(() => f.service.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept" }))
    .toThrow(expect.objectContaining({ code: "STALE_HANDOFF" }));
  expect(f.allRows()).toEqual(before);
  expect(readContentDriftResolution(f.ports, captured.drift!.id).resolution!.decision).toEqual(adopted.resolution.decision);
});
