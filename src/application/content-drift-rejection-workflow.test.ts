// 以真實本機 SQLite 與可重現 fixtures 驗證處置契約，不呼叫真實 provider。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { planeObservationHistoryFixture } from "../test-support/plane-observation-history-fixture.js";
import { ProductGraphService } from "./product-graph-service.js";
import { readContentDriftResolution } from "./content-drift-resolution-support.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";

let f: Awaited<ReturnType<typeof planeObservationHistoryFixture>>;
const directories: string[] = [];
beforeEach(async () => { f = await planeObservationHistoryFixture(); });
afterEach(() => { f.database.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

it("records exactly one server-owned rejection while retaining every existing domain row", () => {
  const captured = f.capture({ id: "captured" });
  const before = f.allRows();
  const clockBefore = f.clockCalls();

  const result = f.service.rejectContentDrift({ contentDriftId: " captured-drift ", reason: "  保留本機規格  " });

  expect(result.evidence).toEqual({ mapping: f.mapping, drift: captured.drift, snapshot: captured.snapshot, observation: captured.provenance });
  expect(result.resolution).toEqual({ record: { id: result.resolution.record.id, projectId: f.project.id,
    contentDriftId: captured.drift!.id, decisionId: result.resolution.decision.id, kind: "reject",
    draftTicketRevisionId: null, auditLogId: result.auditLogId }, decision: {
    id: result.resolution.decision.id, projectId: f.project.id, decisionType: "content_drift_rejection",
    summary: "保留本機規格", actorId: "acceptance-user", createdAt: result.resolution.decision.createdAt }, draft: null });
  expect(f.clockCalls()).toBe(clockBefore + 1);
  const after = f.allRows();
  for (const table of Object.keys(before)) {
    if (["local_actors", "decisions", "audit_log", "content_drift_resolutions"].includes(table)) continue;
    expect(after[table], table).toEqual(before[table]);
  }
  expect(after.decisions).toHaveLength(before.decisions!.length + 1);
  expect(after.content_drift_resolutions).toHaveLength(1);
  expect(after.audit_log).toHaveLength(before.audit_log!.length + 1);
  expect(after.content_drifts).toEqual(before.content_drifts);
  expect(f.ports.auditLog.list().find(row => row.id === result.auditLogId)).toMatchObject({
    projectId: f.project.id, actorId: "acceptance-user", action: "content_drift.rejected",
    entityType: "content_drift_resolution", entityId: result.resolution.record.id,
    createdAt: result.resolution.decision.createdAt, afterSummary: { contentDriftId: captured.drift!.id,
      snapshotId: captured.snapshot.id, mappingId: f.mapping.id, ticketId: f.ticket.id,
      capturedSourceTicketRevisionId: f.revision.id } });
  expect(readContentDriftResolution(f.ports, captured.drift!.id).resolution).toEqual(result.resolution);
});

it("rejects repeated and conflicting reasons without actor, Decision or audit writes", () => {
  const captured = f.capture();
  const first = reject(captured.drift!.id);
  const before = f.allRows();
  const otherActor = new ProductGraphService(f.ports, { actor: { id: "new-actor", displayName: "Other" } });
  for (const reason of ["Reject", "Different decision"]) {
    expect(() => otherActor.rejectContentDrift({ contentDriftId: captured.drift!.id, reason })).toThrow(expect.objectContaining({
      code: "CONFLICT", details: { resolution_id: first.resolution.record.id, decision_id: first.resolution.decision.id }
    }));
    expect(f.allRows()).toEqual(before);
  }
});

it("retains historical evidence after changed planning, newer approval, mapping termination and owner archival", () => {
  const captured = f.capture();
  f.replaceRevision();
  f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "Provider retired" });
  f.database.prepare("UPDATE tickets SET current_approved_revision_id = NULL, lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
  f.database.prepare("UPDATE projects SET lifecycle_status = 'archived', current_graph_revision_id = NULL WHERE id = ?").run(f.project.id);
  f.database.prepare("UPDATE external_work_items SET lifecycle_status = 'archived' WHERE id = ?").run(f.mapping.externalWorkItemId);
  // 處置僅需合法歷史身分；不重驗目前 Spec、graph reconciliation 或同步成功證明。
  f.database.prepare("UPDATE sync_attempts SET response_json = '{'").run();
  const before = f.allRows();

  const result = reject(captured.drift!.id);

  expect(result.evidence.observation.sourceTicketRevisionId).toBe(f.revision.id);
  for (const table of ["projects", "tickets", "ticket_revisions", "external_work_item_mappings", "sync_attempts", "sync_intents"]) {
    expect(f.allRows()[table]).toEqual(before[table]);
  }
});

it.each(["changed", "moved", "archived"])("rejects historical evidence after its actual source Spec becomes %s", scenario => {
  const base = () => f.ports.projects.findById(f.project.id)!.currentGraphRevisionId!;
  const milestone = { type: "milestone" as const, content: { outcome: "Deliver feature", exit_criteria: ["Feature works"],
    sequence: 1, scope: ["Feature"], non_goals: [] } };
  const document = { type: "spec" as const, content: { problem_statement: "Need feature", solution: "Deliver feature",
    user_stories: ["Use feature"], implementation_decisions: [], testing_decisions: ["Verify feature"], out_of_scope: [], further_notes: [] } };
  const stage = f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: base(), title: "Stage", document: milestone });
  const spec = f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: base(), title: "Spec", document, parentNodeId: stage.node.id });
  const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
    sourceGraphRevisionId: base(), specification: { title: "Feature with Spec", sourceSpecId: spec.node.id,
      userStory: "Use feature", scope: ["Feature"], acceptanceCriteria: ["Works"], nonGoals: [], relatedGraphNodeIds: [],
      implementationTargets: f.revision.requiredTargets.map(value => ({ repositoryId: value.repository_id, scope: value.scope })), implementationNotes: [] } });
  const approved = f.service.approveTicketRevision(draft.revision.id);
  const captured = f.capture({ revisionId: approved.revision.id });
  if (scenario === "archived") {
    f.service.planning.archive({ projectId: f.project.id, baseGraphRevisionId: base(), nodeId: spec.node.id });
  } else {
    const parent = scenario === "moved" ? f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: base(),
      title: "Other stage", document: milestone }).node.id : stage.node.id;
    f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: base(), title: "Updated Spec",
      document, parentNodeId: parent, nodeId: spec.node.id });
  }
  const before = f.allRows();
  expect(reject(captured.drift!.id).evidence.observation.sourceTicketRevisionId).toBe(approved.revision.id);
  for (const table of ["graph_nodes", "graph_edges", "ticket_revisions", "tickets", "content_drifts"]) {
    expect(f.allRows()[table]).toEqual(before[table]);
  }
});

it("ignores malformed unrelated observations and sync intents but verifies the exact selected snapshot", () => {
  f.capture({ id: "selected" });
  f.capture({ id: "unrelated" });
  disableGuards();
  f.database.exec("UPDATE content_drifts SET diff_json = '{' WHERE id = 'unrelated-drift'; UPDATE sync_intents SET payload_json = '{'; UPDATE external_work_item_snapshots SET content_json = '{' WHERE id = 'unrelated'");

  expect(reject("selected-drift").resolution.record.kind).toBe("reject");
  expect(() => reject("unrelated-drift")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
});

it("does not inspect a newer unrelated revision when rejecting saved historical evidence", () => {
  const captured = f.capture();
  const newer = f.replaceRevision();
  f.database.prepare("UPDATE ticket_revisions SET specification_json = '{', required_targets_json = '{', metadata_json = '{' WHERE id = ?")
    .run(newer.id);
  const before = f.allRows();

  const result = reject(captured.drift!.id);

  expect(result.evidence.drift).toEqual(captured.drift);
  expect(result.evidence.observation.sourceTicketRevisionId).toBe(f.revision.id);
  expect(f.allRows().ticket_revisions).toEqual(before.ticket_revisions);
});

it("allows marker-only drift rejection without changing external markers", () => {
  const captured = f.capture({ changes: [{ field: "external_source", expected: "other", observed: { present: true, value: "ai-product-graph" } }] });
  expect(reject(captured.drift!.id).resolution.record.kind).toBe("reject");
  expect(f.ports.planeObservationReads.readDrift(captured.drift!.id)!.snapshot).toEqual(captured.snapshot);
});

it.each([
  ["mapping owner", "UPDATE external_work_item_mappings SET internal_owner_type = 'implementation_target'"],
  ["mapping JSON", "UPDATE external_work_item_mappings SET metadata_json = '{'"],
  ["missing mapping", "DELETE FROM external_work_item_mappings"],
  ["missing project", "DELETE FROM projects"],
  ["snapshot scope", "UPDATE external_work_item_snapshots SET project_id = 'other' WHERE id = 'captured'"],
  ["snapshot item", "UPDATE external_work_item_snapshots SET external_work_item_id = 'other' WHERE id = 'captured'"],
  ["snapshot mapping", "UPDATE external_work_item_snapshots SET mapping_id = 'other' WHERE id = 'captured'"],
  ["snapshot missing", "DELETE FROM external_work_item_snapshots WHERE id = 'captured'"],
  ["snapshot JSON", "UPDATE external_work_item_snapshots SET content_json = '{' WHERE id = 'captured'"],
  ["snapshot nonobject", "UPDATE external_work_item_snapshots SET content_json = '[]' WHERE id = 'captured'"],
  ["missing observation", "DELETE FROM plane_observations"],
  ["observation scope", "UPDATE plane_observations SET project_id = 'other'"],
  ["observation mapping", "UPDATE plane_observations SET mapping_id = 'other'"],
  ["observation item", "UPDATE plane_observations SET external_work_item_id = 'other'"],
  ["observation ticket", "UPDATE plane_observations SET ticket_id = 'other'"],
  ["captured revision missing", "UPDATE plane_observations SET source_ticket_revision_id = 'other'"],
  ["captured revision specification JSON", "UPDATE ticket_revisions SET specification_json = '{' WHERE id = (SELECT source_ticket_revision_id FROM plane_observations WHERE snapshot_id = 'captured')"],
  ["captured revision targets JSON", "UPDATE ticket_revisions SET required_targets_json = '{' WHERE id = (SELECT source_ticket_revision_id FROM plane_observations WHERE snapshot_id = 'captured')"],
  ["captured revision metadata JSON", "UPDATE ticket_revisions SET metadata_json = '{' WHERE id = (SELECT source_ticket_revision_id FROM plane_observations WHERE snapshot_id = 'captured')"],
  ["captured revision draft", "UPDATE ticket_revisions SET review_status = 'draft'"],
  ["captured revision owner", "UPDATE ticket_revisions SET ticket_id = 'other'"],
  ["observer actor", "UPDATE plane_observations SET actor_id = 'other'"],
  ["observation audit JSON", "UPDATE audit_log SET after_summary_json = '{' WHERE entity_type = 'plane_observation'"],
  ["observation audit", "UPDATE audit_log SET action = 'wrong' WHERE entity_type = 'plane_observation'"],
  ["drift owner", "UPDATE content_drifts SET internal_owner_id = 'other'"],
  ["drift project", "UPDATE content_drifts SET project_id = 'other'"],
  ["drift mapping", "UPDATE content_drifts SET mapping_id = 'other'"],
  ["drift snapshot", "UPDATE content_drifts SET snapshot_id = 'other'"],
  ["raw legacy ref", "UPDATE content_drifts SET resolution_decision_id = 'legacy'"],
  ["malformed diff", "UPDATE content_drifts SET diff_json = '{'"],
  ["unsupported diff", "UPDATE content_drifts SET diff_json = json_set(diff_json, '$.schema_version', 2)"],
  ["empty diff", "UPDATE content_drifts SET diff_json = json_set(diff_json, '$.changes', json('[]'))"],
  ["wrong captured revision", "UPDATE content_drifts SET diff_json = json_set(diff_json, '$.source_ticket_revision_id', 'other')"],
  ["observed mismatch", "UPDATE content_drifts SET diff_json = json_set(diff_json, '$.changes[0].observed.value', 'other')"],
  ["duplicate fields", "UPDATE content_drifts SET diff_json = json_set(diff_json, '$.changes[1]', json_extract(diff_json, '$.changes[0]'))"],
  ["sibling drift", "INSERT INTO content_drifts (id, project_id, mapping_id, snapshot_id, internal_owner_type, internal_owner_id, diff_json, detected_at, resolution_decision_id) SELECT 'sibling', project_id, mapping_id, snapshot_id, internal_owner_type, internal_owner_id, diff_json, detected_at, resolution_decision_id FROM content_drifts WHERE id = 'captured-drift'"]
])("fails closed and rolls back a new actor for corrupt %s", (_name, sql) => {
  f.capture({ id: "captured" });
  disableGuards(); f.database.exec(sql);
  const before = f.allRows();
  const target = new ProductGraphService(f.ports, { actor: { id: "new-actor", displayName: "Other" } });
  expect(() => target.rejectContentDrift({ contentDriftId: "captured-drift", reason: "Reject" }))
    .toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
});

it("rejects valid same-project legacy Decision without an authoritative association", () => {
  const captured = f.capture();
  const terminated = f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "Stop" });
  f.database.exec("DROP TRIGGER content_drift_resolution_reference_immutable");
  f.database.prepare("UPDATE content_drifts SET resolution_decision_id = ?").run(terminated.decision.id);
  expect(() => reject(captured.drift!.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
});

it.each(["decision", "audit", "association"])("rolls back all new writes after %s persistence failure", point => {
  const captured = f.capture();
  const table = { decision: "decisions", audit: "audit_log", association: "content_drift_resolutions" }[point];
  f.database.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  const before = f.allRows();
  const target = new ProductGraphService(f.ports, { actor: { id: "new-actor", displayName: "Other" } });
  expect(() => target.rejectContentDrift({ contentDriftId: captured.drift!.id, reason: "Reject" })).toThrow("injected failure");
  expect(f.allRows()).toEqual(before);
});

it("returns NOT_FOUND only for an absent drift and propagates unexpected storage failures", () => {
  const before = f.allRows();
  expect(() => reject("missing")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  expect(f.allRows()).toEqual(before);
  vi.spyOn(f.ports.planeObservationReads, "readDrift").mockImplementation(() => { throw new Error("disk failure"); });
  expect(() => reject("missing")).toThrow("disk failure");
  expect(f.allRows()).toEqual(before);
});

it.each([{ contentDriftId: " " }, { reason: " " }, { actorId: "client" }, { projectId: "client" },
  { createdAt: "client" }, { kind: "adopt" }, { draftTicketRevisionId: "client" }])("rejects invalid or server-owned input %j", extra => {
  const captured = f.capture();
  const before = f.allRows();
  expect(() => f.service.rejectContentDrift({ contentDriftId: captured.drift!.id, reason: "Reject", ...extra }))
    .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  expect(f.allRows()).toEqual(before);
});

it("serializes two concurrent connections into one rejection and persists all guards on reopen", async () => {
  const captured = f.capture();
  const directory = mkdtempSync(join(tmpdir(), "drift-rejection-")); directories.push(directory);
  const path = join(directory, "db.sqlite"); await f.database.backup(path);
  const script = `import { openDatabase } from './src/infrastructure/sqlite/database.ts';
    import { createSqlitePorts } from './src/infrastructure/sqlite/repositories.ts';
    import { ProductGraphService } from './src/application/product-graph-service.ts';
    const db = openDatabase(process.argv[1]);
    try { const r = new ProductGraphService(createSqlitePorts(db)).rejectContentDrift({contentDriftId: process.argv[2],reason:'Reject'});
      console.log(JSON.stringify({id:r.resolution.record.id})); }
    catch(e) { console.log(JSON.stringify({code:e.code,details:e.details})); } finally { db.close(); }`;
  const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path, captured.drift!.id]);
  const outcomes = (await Promise.all([run(), run()])).map(value => JSON.parse(value.stdout));
  const success = outcomes.find(value => value.id);
  expect(outcomes.filter(value => value.id)).toHaveLength(1);
  expect(["CONFLICT", "SQLITE_BUSY"]).toContain(outcomes.find(value => value.code).code);
  const db = openDatabase(path);
  try {
    const ports = createSqlitePorts(db);
    const result = readContentDriftResolution(ports, captured.drift!.id);
    expect(result.resolution!.record.id).toBe(success.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM decisions WHERE decision_type = 'content_drift_rejection'").get()).toEqual({ count: 1 });
    expect(() => new ProductGraphService(ports).rejectContentDrift({ contentDriftId: captured.drift!.id, reason: "Retry" }))
      .toThrow(expect.objectContaining({ code: "CONFLICT", details: expect.objectContaining({ resolution_id: success.id }) }));
    for (const sql of ["UPDATE content_drift_resolutions SET kind = 'adopt'", "DELETE FROM content_drift_resolutions",
      `UPDATE decisions SET summary = 'changed' WHERE id = '${result.resolution!.decision.id}'`,
      `DELETE FROM decisions WHERE id = '${result.resolution!.decision.id}'`,
      "UPDATE content_drifts SET resolution_decision_id = 'changed'", "UPDATE content_drifts SET diff_json = '{}'",
      "UPDATE external_work_item_snapshots SET content_json = '{}' WHERE id = 'observation-1'"]) {
      expect(() => db.exec(sql)).toThrow("immutable");
    }
  } finally { db.close(); }
});

function reject(id: string) { return f.service.rejectContentDrift({ contentDriftId: id, reason: "Reject" }); }
function disableGuards() {
  // Corruption fixture 明確拆除防護，模擬舊版或離線損壞；正式 workflow 不做這些操作。
  f.database.pragma("foreign_keys = OFF");
  const triggers = f.database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[];
  for (const { name } of triggers) f.database.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
}
