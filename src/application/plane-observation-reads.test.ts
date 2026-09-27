import { afterEach, beforeEach, expect, it } from "vitest";
import { planeObservationHistoryFixture } from "../test-support/plane-observation-history-fixture.js";

let f: Awaited<ReturnType<typeof planeObservationHistoryFixture>>;
beforeEach(async () => { f = await planeObservationHistoryFixture(); });
afterEach(() => f.database.close());

it("returns empty inbound history while retaining the mapping even when only its outbound snapshot exists", () => {
  const before = f.allRows();

  const result = f.service.getMappingContentDriftHistory(f.mapping.id);

  expect(result).toEqual({ mapping: f.mapping, observations: [], drifts: [] });
  expect(f.allRows()).toEqual(before);
});

it("returns pinned observations/diffs in receipt/detection order with ID ties and preserves unknown JSON", () => {
  const later = f.capture({ id: "z", capturedAt: "2026-09-27T12:00:00.000Z", detectedAt: "2026-09-27T12:00:01.000Z" });
  const tieB = f.capture({ id: "b" });
  const tieA = f.capture({ id: "a" });
  const matching = f.capture({ id: "matching", capturedAt: "2026-09-27T09:00:00.000Z", changes: [] });
  const before = f.allRows();

  const result = f.service.getMappingContentDriftHistory(f.mapping.id);

  expect(result.observations).toEqual([matching, tieA, tieB, later].map(({ snapshot, provenance }) => ({ snapshot, provenance })));
  expect(result.drifts).toEqual([tieA.drift, tieB.drift, later.drift]);
  const future = (result.observations[1]!.snapshot.content as { future: Record<string, unknown> }).future;
  expect(Object.hasOwn(future, "__proto__")).toBe(true);
  expect(future.__proto__).toEqual({ value: 1 });
  expect(f.allRows()).toEqual(before);
});

it("retains historical compared revisions after approval and archive without requiring current outbound proof", () => {
  const old = f.capture();
  const original = f.service.getMappingContentDriftHistory(f.mapping.id);
  const revision = f.replaceRevision();
  const next = f.capture({ revisionId: revision.id, changes: [{ field: "name", expected: "New title", observed: { present: true, value: "External <title>" } }] });
  f.database.prepare("UPDATE sync_attempts SET response_json = '{}' WHERE result_status = 'succeeded'").run();
  f.database.prepare("UPDATE external_work_item_mappings SET lifecycle_status = 'archived', archived_at = ? WHERE id = ?")
    .run("2026-09-27T13:00:00.000Z", f.mapping.id);
  const before = f.allRows();

  const result = f.service.getMappingContentDriftHistory(f.mapping.id);

  expect(result.mapping.lifecycleStatus).toBe("archived");
  expect(result.observations[0]).toEqual(original.observations[0]);
  expect(result.drifts).toEqual([old.drift, next.drift]);
  expect(result.observations.map(value => value.provenance.sourceTicketRevisionId)).toEqual([f.revision.id, revision.id]);
  expect(f.allRows()).toEqual(before);
});

it("exposes the stored resolution Decision reference without interpreting its decision type", () => {
  const captured = f.capture();
  f.ports.decisions.insert({ id: "future-resolution", projectId: f.project.id, actorId: captured.provenance.actorId,
    decisionType: "future_content_resolution", summary: "External decision", payload: {}, createdAt: "2026-09-27T13:00:00.000Z" });
  f.database.prepare("UPDATE content_drifts SET resolution_decision_id = 'future-resolution' WHERE id = ?").run(captured.drift!.id);

  const result = f.service.getMappingContentDriftHistory(f.mapping.id);

  expect(result.drifts[0]!.resolutionDecisionId).toBe("future-resolution");
  expect(result.drifts[0]).not.toHaveProperty("resolutionState");
});

it("returns NOT_FOUND for an unknown mapping", () => {
  expect(() => f.service.getMappingContentDriftHistory("missing")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
});

it.each([
  ["mapping owner type", "UPDATE external_work_item_mappings SET internal_owner_type = 'implementation_target'"],
  ["snapshot mapping", "UPDATE external_work_item_snapshots SET mapping_id = 'missing-mapping' WHERE id = 'captured'"],
  ["observation mapping", "UPDATE plane_observations SET mapping_id = 'missing-mapping'"],
  ["observation project", "UPDATE plane_observations SET project_id = 'other-project'"],
  ["observation owner", "UPDATE plane_observations SET ticket_id = 'other-ticket'"],
  ["observation item", "UPDATE plane_observations SET external_work_item_id = 'other-item'"],
  ["missing snapshot", "DELETE FROM external_work_item_snapshots WHERE id = 'captured'"],
  ["snapshot project", "UPDATE external_work_item_snapshots SET project_id = 'other-project' WHERE id = 'captured'"],
  ["snapshot item", "UPDATE external_work_item_snapshots SET external_work_item_id = 'other-item' WHERE id = 'captured'"],
  ["snapshot JSON", "UPDATE external_work_item_snapshots SET content_json = 'null' WHERE id = 'captured'"],
  ["source revision", "UPDATE plane_observations SET source_ticket_revision_id = 'missing-revision'"],
  ["actor", "UPDATE plane_observations SET actor_id = 'missing-actor'"],
  ["audit", "UPDATE audit_log SET project_id = 'other-project' WHERE entity_type = 'plane_observation'"],
  ["audit identity", "UPDATE audit_log SET entity_id = 'other-snapshot' WHERE entity_type = 'plane_observation'"],
  ["drift mapping", "UPDATE content_drifts SET mapping_id = 'missing-mapping'"],
  ["drift snapshot", "UPDATE content_drifts SET snapshot_id = 'missing-snapshot'"],
  ["drift owner", "UPDATE content_drifts SET internal_owner_id = 'other-ticket'"],
  ["drift project", "UPDATE content_drifts SET project_id = 'other-project'"],
  ["missing resolution", "UPDATE content_drifts SET resolution_decision_id = 'missing-decision'"],
  ["malformed diff", "UPDATE content_drifts SET diff_json = '{'"],
  ["unpinned diff", "UPDATE content_drifts SET diff_json = json_set(diff_json, '$.source_ticket_revision_id', 'other-revision')"],
  ["snapshot/diff mismatch", "UPDATE content_drifts SET diff_json = json_set(diff_json, '$.changes[0].observed.value', 'different')"]
])("fails closed for known corrupt %s instead of hiding history", (_name, sql) => {
  f.capture({ id: "captured" });
  disableGuards();
  f.database.exec(sql);
  const before = f.allRows();

  expect(() => f.service.getMappingContentDriftHistory(f.mapping.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
});

it("rejects a real cross-project resolution Decision while preserving every row", () => {
  const captured = f.capture();
  const other = f.service.createProject({ name: "Other" }).project;
  f.ports.decisions.insert({ id: "foreign-resolution", projectId: other.id, actorId: captured.provenance.actorId,
    decisionType: "future_resolution", summary: "Foreign", payload: {}, createdAt: "2026-09-27T13:00:00.000Z" });
  f.database.prepare("UPDATE content_drifts SET resolution_decision_id = 'foreign-resolution'").run();
  const before = f.allRows();

  expect(() => f.service.getMappingContentDriftHistory(f.mapping.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
});

function disableGuards() {
  // 只在 corruption 測試拆除 write guards，模擬舊資料或離線損壞，不變更正式 migration。
  f.database.pragma("foreign_keys = OFF");
  const triggers = f.database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[];
  for (const { name } of triggers) f.database.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
}
