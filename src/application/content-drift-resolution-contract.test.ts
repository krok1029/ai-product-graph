// 以真實本機 SQLite 與可重現 fixtures 驗證處置契約，不呼叫真實 provider。
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ContentDriftResolution } from "../domain/content-drift-resolution.js";
import type { Decision } from "../domain/result-acceptance.js";
import { planeObservationHistoryFixture } from "../test-support/plane-observation-history-fixture.js";
import { ProductGraphService } from "./product-graph-service.js";
import { serializeContentDriftResolution } from "../adapters/mcp/content-drift-resolution-serialization.js";
import { readContentDriftResolution } from "./content-drift-resolution-support.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";

let f: Awaited<ReturnType<typeof planeObservationHistoryFixture>>;
beforeEach(async () => { f = await planeObservationHistoryFixture(); });
afterEach(() => { f.database.close(); });

it("reserves a real adopted draft, rejects conflicting rejection and permits ordinary approval", () => {
  const { record, draft, decision } = adoptedFixture();
  const before = f.allRows();
  expect(f.service.getContentDriftResolution(record.contentDriftId).resolution).toEqual({ record, draft, decision });
  expect(serializeContentDriftResolution(f.service.getContentDriftResolution(record.contentDriftId))).toMatchObject({
    evidence: { captured_source_ticket_revision_id: f.revision.id },
    resolution: { record: { kind: "adopt" }, draft: { id: draft.id, base_approved_revision_id: f.revision.id,
      source_graph_revision_id: f.graph.graphRevision.id, review_status: "draft", lifecycle_status: "active" } }
  });
  expect(f.service.getMappingContentDriftHistory(f.mapping.id).drifts[0]).toMatchObject({
    resolutionDecisionId: decision.id, resolution: { record, draft, decision }
  });
  expect(() => f.service.rejectContentDrift({ contentDriftId: record.contentDriftId, reason: "Reject instead" }))
    .toThrow(expect.objectContaining({ code: "CONFLICT", details: { resolution_id: record.id, decision_id: decision.id } }));
  expect(f.allRows()).toEqual(before);
  const approved = f.service.approveTicketRevision(draft.id);
  expect(f.service.getContentDriftResolution(record.contentDriftId).resolution!.draft).toEqual(approved.revision);
  expect(f.service.getMappingContentDriftHistory(f.mapping.id).drifts[0]!.resolution!.draft).toEqual(approved.revision);
  expect(f.database.prepare("SELECT resolution_decision_id AS raw FROM content_drifts").get()).toEqual({ raw: null });
});

it("permits adopted draft stale archival while freezing its specification and provenance", () => {
  const { record, draft } = adoptedFixture();
  for (const change of ["title = 'changed'", "specification_json = '{}'", "required_targets_json = '[]'",
    "base_approved_revision_id = NULL", "source_graph_revision_id = 'missing'", "ticket_id = 'missing'"]) {
    expect(() => f.database.prepare(`UPDATE ticket_revisions SET ${change} WHERE id = ?`).run(draft.id)).toThrow("immutable");
  }
  expect(() => f.database.prepare("DELETE FROM ticket_revisions WHERE id = ?").run(draft.id)).toThrow("immutable");
  expect(() => f.database.prepare("DELETE FROM ticket_revision_graph_nodes WHERE ticket_revision_id = ?").run(draft.id)).toThrow("immutable");
  f.replaceRevision();
  expect(f.service.getContentDriftResolution(record.contentDriftId).resolution!.draft!.lifecycleStatus).toBe("archived");
  expect(f.service.getMappingContentDriftHistory(f.mapping.id).drifts[0]!.resolution!.draft!.lifecycleStatus).toBe("archived");
});

it("enforces relation write transactions, kind/draft and project/actor/audit identity", () => {
  const { record, draft, decision } = adoptedFixture();
  expect(() => f.ports.contentDriftResolutions.insert(record)).toThrow("requires a transaction");
  const second = f.capture({ id: "second" });
  for (const sql of [
    `INSERT INTO content_drift_resolutions VALUES ('bad', '${f.project.id}', '${second.drift!.id}', '${decision.id}', 'reject', '${draft.id}', '${record.auditLogId}')`,
    `INSERT INTO content_drift_resolutions VALUES ('bad', '${f.project.id}', '${second.drift!.id}', '${decision.id}', 'adopt', NULL, '${record.auditLogId}')`,
    `INSERT INTO content_drift_resolutions VALUES ('bad', '${f.project.id}', '${second.drift!.id}', '${decision.id}', 'unknown', NULL, '${record.auditLogId}')`
  ]) expect(() => f.database.exec(sql)).toThrow();
  for (const change of ["project_id = 'other'", "kind = 'reject'", "decision_id = 'other'", "draft_ticket_revision_id = NULL", "audit_log_id = 'other'"]) {
    expect(() => f.database.exec(`UPDATE content_drift_resolutions SET ${change}`)).toThrow("immutable");
  }
});

it.each([
  ["decision project", "UPDATE decisions SET project_id = 'other' WHERE id = 'adopt-decision'"],
  ["decision kind", "UPDATE decisions SET decision_type = 'sync_mapping_termination' WHERE id = 'adopt-decision'"],
  ["decision actor", "UPDATE decisions SET actor_id = 'other' WHERE id = 'adopt-decision'"],
  ["decision time", "UPDATE decisions SET created_at = 'other' WHERE id = 'adopt-decision'"],
  ["decision empty reason", "UPDATE decisions SET summary = ' ' WHERE id = 'adopt-decision'"],
  ["decision missing", "DELETE FROM decisions WHERE id = 'adopt-decision'"],
  ["audit JSON", "UPDATE audit_log SET after_summary_json = '{' WHERE id = 'adopt-audit'"],
  ["audit project", "UPDATE audit_log SET project_id = 'other' WHERE id = 'adopt-audit'"],
  ["audit actor", "UPDATE audit_log SET actor_id = 'other' WHERE id = 'adopt-audit'"],
  ["audit entity", "UPDATE audit_log SET entity_id = 'other' WHERE id = 'adopt-audit'"],
  ["audit action", "UPDATE audit_log SET action = 'other' WHERE id = 'adopt-audit'"],
  ["association project", "UPDATE content_drift_resolutions SET project_id = 'other'"],
  ["association wrong kind", "UPDATE content_drift_resolutions SET kind = 'reject', draft_ticket_revision_id = NULL"],
  ["draft owner", "UPDATE ticket_revisions SET ticket_id = 'other' WHERE id = (SELECT draft_ticket_revision_id FROM content_drift_resolutions)"],
  ["draft project", "UPDATE ticket_revisions SET project_id = 'other' WHERE id = (SELECT draft_ticket_revision_id FROM content_drift_resolutions)"],
  ["draft malformed JSON", "UPDATE ticket_revisions SET specification_json = '{' WHERE id = (SELECT draft_ticket_revision_id FROM content_drift_resolutions)"],
  ["draft missing", "DELETE FROM ticket_revisions WHERE id = (SELECT draft_ticket_revision_id FROM content_drift_resolutions)"],
  ["base missing", "UPDATE ticket_revisions SET base_approved_revision_id = 'other' WHERE id = (SELECT draft_ticket_revision_id FROM content_drift_resolutions)"],
  ["source graph missing", "UPDATE ticket_revisions SET source_graph_revision_id = 'other' WHERE id = (SELECT draft_ticket_revision_id FROM content_drift_resolutions)"],
  ["raw pointer mismatch", "UPDATE content_drifts SET resolution_decision_id = 'other'"]
])("rejects broken saved resolution %s without treating it as unresolved", (_name, sql) => {
  const { record } = adoptedFixture();
  disableGuards(); f.database.exec(sql);
  const before = f.allRows();
  expect(() => f.service.getContentDriftResolution(record.contentDriftId)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(() => f.service.getMappingContentDriftHistory(f.mapping.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(() => f.service.rejectContentDrift({ contentDriftId: record.contentDriftId, reason: "No" })).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
});

it("accepts a matching legacy raw reference only when the full association is valid", () => {
  const { record, decision } = adoptedFixture();
  f.database.exec("DROP TRIGGER content_drift_resolution_reference_immutable");
  f.database.prepare("UPDATE content_drifts SET resolution_decision_id = ?").run(decision.id);
  expect(readContentDriftResolution(f.ports, record.contentDriftId).resolution!.record).toEqual(record);
});

it("upgrades legacy storage without rewriting a raw reference and fails closed afterward", async () => {
  const captured = f.capture();
  const termination = f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "Legacy decision" });
  const directory = mkdtempSync(join(tmpdir(), "legacy-drift-"));
  const path = join(directory, "db.sqlite");
  try {
    // 還原 migration 010 形狀，並保存當時允許的 raw pointer，再測正式 011 upgrade。
    const names = f.database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'content_drift_resolution%' OR name LIKE 'adopted_ticket_revision%')").all() as { name: string }[];
    for (const { name } of names) f.database.exec(`DROP TRIGGER ${name}`);
    f.database.exec("DROP TABLE content_drift_resolutions; DELETE FROM schema_migrations WHERE version = '011_content_drift_resolutions.sql'");
    f.database.prepare("UPDATE content_drifts SET resolution_decision_id = ?").run(termination.decision.id);
    const raw = f.database.prepare("SELECT * FROM content_drifts").all();
    await f.database.backup(path);
    const db = openDatabase(path);
    try {
      expect(db.prepare("SELECT * FROM content_drifts").all()).toEqual(raw);
      expect(() => readContentDriftResolution(createSqlitePorts(db), captured.drift!.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
      expect(() => db.exec("UPDATE content_drifts SET resolution_decision_id = NULL")).toThrow("immutable");
    } finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// 使用正式 TicketWorkflow 建 draft，再以正式 repository 建 reserved adopt 關係；不虛構 DTO casts。
function adoptedFixture() {
  const captured = f.capture();
  const time = "2026-09-28T10:00:00.000Z";
  const service = new ProductGraphService(f.ports, { actor: { id: "acceptance-user", displayName: "Reviewer" }, clock: () => new Date(time) });
  return f.ports.transactions.run(() => {
    const draft = service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
      sourceGraphRevisionId: f.graph.graphRevision.id, specification: { title: "Selected external title", userStory: "New story",
        scope: ["Feature"], acceptanceCriteria: ["New criterion"], nonGoals: [], relatedGraphNodeIds: [f.goal],
        implementationTargets: f.revision.requiredTargets.map(value => ({ repositoryId: value.repository_id, scope: value.scope })),
        implementationNotes: [] } }).revision;
    const decision: Decision = { id: "adopt-decision", projectId: f.project.id, decisionType: "content_drift_adoption",
      summary: "Selected external specification", actorId: "acceptance-user", createdAt: time };
    const record: ContentDriftResolution = { id: "adopt-resolution", projectId: f.project.id, contentDriftId: captured.drift!.id,
      decisionId: decision.id, kind: "adopt", draftTicketRevisionId: draft.id, auditLogId: "adopt-audit" };
    f.ports.decisions.insert(decision);
    f.ports.auditLog.append({ id: record.auditLogId, projectId: f.project.id, actorType: "mcp_client", actorId: decision.actorId,
      action: "content_drift.adopted", entityType: "content_drift_resolution", entityId: record.id, createdAt: time,
      beforeSummary: null, afterSummary: null, metadata: {} });
    f.ports.contentDriftResolutions.insert(record);
    return { record, decision, draft };
  });
}
function disableGuards() {
  f.database.pragma("foreign_keys = OFF");
  const triggers = f.database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[];
  for (const { name } of triggers) f.database.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
}
