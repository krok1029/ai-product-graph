import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { mappingTerminationReadFixture } from "../test-support/mapping-termination-read-fixture.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { MappingTerminationReads } from "./mapping-termination-reads.js";

let f: ReturnType<typeof mappingTerminationReadFixture>;
let target: MappingTerminationReads;
beforeEach(() => { f = mappingTerminationReadFixture(); target = new MappingTerminationReads(f.ports); });
afterEach(() => f.database.close());

it("returns null for a valid unterminated mapping and NOT_FOUND for an unknown identity", async () => {
  const { mapping } = await f.exportMapping();

  const history = target.get(mapping.id);

  expect(history).toEqual({ mappingId: mapping.id, termination: null });
  expect(() => target.get("missing")).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
});

it("explains stopped pending, failed, running and archived obligations without rewriting outcomes", async () => {
  // 前置：sequence 與 ID 順序相反，並保留重試的 durable 順序。
  const { mapping, create } = await f.exportMapping();
  const pending = f.mappedIntent(mapping, 1, "z-pending");
  const failed = f.mappedIntent(mapping, 2, "y-failed");
  f.attempt(mapping, failed, "failed", "z-attempt");
  f.attempt(mapping, failed, "failed", "a-attempt");
  const running = f.mappedIntent(mapping, 3, "x-running");
  f.attempt(mapping, running, "started");
  const archived = f.mappedIntent(mapping, 4, "w-archived");
  f.database.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = ?").run(archived.id);
  const succeeded = f.mappedIntent(mapping, 5, "v-succeeded");
  f.attempt(mapping, succeeded, "succeeded");
  const stopped = [pending, failed, running, archived].map(intent => f.service.getSyncIntent(intent.id));
  const terminated = f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "  Provider retired  " });
  const before = f.database.prepare("SELECT total_changes() AS count").get();

  // 操作：重複讀取相同 termination snapshot。
  const history = target.get(mapping.id);

  // 驗證：停止是一項決策，所有結果與 errors 原樣保留；成功 create 不納入停止。
  expect(history).toEqual({ mappingId: mapping.id, termination: { termination: terminated.termination,
    decision: terminated.decision, stoppedIntents: stopped } });
  expect(history.termination!.termination.stoppedSyncIntentIds).toEqual([pending.id, failed.id, running.id, archived.id]);
  expect(history.termination!.decision.summary).toBe("Provider retired");
  expect(history.termination!.stoppedIntents[1]!.attempts.map(value => value.id)).toEqual(["a-attempt", "z-attempt"]);
  expect(target.get(mapping.id)).toEqual(history);
  expect(f.database.prepare("SELECT total_changes() AS count").get()).toEqual(before);
  expect(f.service.getSyncIntent(create.id).requestState).toBe("succeeded");
  expect(f.service.getMappingSyncHealth(mapping.id)).toMatchObject({ included: false, syncHealth: "current" });
});

it("does not require unrelated original create proof and keeps other mappings isolated", async () => {
  const first = await f.exportMapping("first");
  const second = await f.exportMapping("second");
  const stopped = f.mappedIntent(first.mapping, 1);
  f.mappedIntent(second.mapping, 1);
  f.database.prepare("UPDATE external_work_item_mappings SET metadata_json = '{}' WHERE id = ?").run(first.mapping.id);
  f.service.terminateSyncMapping({ mappingId: first.mapping.id, reason: "Stop first" });

  const history = target.get(first.mapping.id);

  expect(history.termination!.stoppedIntents.map(value => value.syncIntent.id)).toEqual([stopped.id]);
  expect(target.get(second.mapping.id)).toEqual({ mappingId: second.mapping.id, termination: null });
});

it.each(["mapping-project", "decision-project", "decision-type", "decision-time", "active-mapping",
  "intent-project", "intent-container", "intent-mapping", "attempt-key", "attempt-item", "succeeded-member"])(
  "rejects corrupt %s scope instead of returning null or leaking foreign history", async field => {
    const first = await f.exportMapping("first");
    const second = await f.exportMapping("second");
    const intent = f.mappedIntent(first.mapping, 1);
    f.attempt(first.mapping, intent, "failed");
    const terminated = f.service.terminateSyncMapping({ mappingId: first.mapping.id, reason: "Stop" });
    const foreign = f.service.createProject({ name: "Foreign" }).project;
    // 此案例刻意模擬既有壞資料；正式 writer 的 immutable trigger 仍保留。
    f.database.exec("DROP TRIGGER terminated_mapping_decisions_no_update");
    if (field === "mapping-project") f.database.prepare("UPDATE external_work_item_mappings SET project_id = ? WHERE id = ?").run(foreign.id, first.mapping.id);
    else if (field === "decision-project") f.database.prepare("UPDATE decisions SET project_id = ? WHERE id = ?").run(foreign.id, terminated.decision.id);
    else if (field === "decision-type") f.database.prepare("UPDATE decisions SET decision_type = 'acceptance_criterion_waiver' WHERE id = ?").run(terminated.decision.id);
    else if (field === "decision-time") f.database.prepare("UPDATE decisions SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(terminated.decision.id);
    else if (field === "active-mapping") f.database.prepare("UPDATE external_work_item_mappings SET lifecycle_status = 'active' WHERE id = ?").run(first.mapping.id);
    else if (field === "intent-project") f.database.prepare("UPDATE sync_intents SET project_id = ? WHERE id = ?").run(foreign.id, intent.id);
    else if (field === "intent-container") f.database.prepare("UPDATE sync_intents SET external_container_id = ? WHERE id = ?").run(second.mapping.externalContainerId, intent.id);
    else if (field === "intent-mapping") f.database.prepare("UPDATE sync_intents SET mapping_id = ? WHERE id = ?").run(second.mapping.id, intent.id);
    else if (field === "attempt-key") f.database.prepare("UPDATE sync_attempts SET idempotency_key = 'foreign' WHERE sync_intent_id = ?").run(intent.id);
    else if (field === "attempt-item") f.database.prepare("UPDATE sync_attempts SET external_work_item_id = ? WHERE sync_intent_id = ?").run(second.mapping.externalWorkItemId, intent.id);
    else f.database.prepare("UPDATE sync_attempts SET result_status = 'succeeded' WHERE sync_intent_id = ?").run(intent.id);

    expect(() => target.get(first.mapping.id)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(target.get(second.mapping.id).termination).toBeNull();
  }
);

it("reads one snapshot while another connection changes a stopped attempt and survives reopen", async () => {
  const { mapping } = await f.exportMapping();
  const intent = f.mappedIntent(mapping, 1);
  f.attempt(mapping, intent, "failed");
  f.service.terminateSyncMapping({ mappingId: mapping.id, reason: "Stop" });
  const directory = mkdtempSync(join(tmpdir(), "termination-snapshot-"));
  const path = join(directory, "project.sqlite");
  writeFileSync(path, f.database.serialize());
  const reader = openDatabase(path);
  reader.pragma("journal_mode = WAL");
  const writer = openDatabase(path);
  try {
    const ports = createSqlitePorts(reader);
    const find = ports.syncMappingTerminations.findByMappingId;
    ports.syncMappingTerminations.findByMappingId = id => {
      const details = find(id);
      writer.prepare("UPDATE sync_attempts SET error_json = '{\"code\":\"CHANGED\"}' WHERE sync_intent_id = ?").run(intent.id);
      return details;
    };

    const history = new MappingTerminationReads(ports).get(mapping.id);

    expect(history.termination!.stoppedIntents[0]!.attempts[0]!.error).toEqual({ code: "FAILED", detail: [null, "原文"] });
    const reopened = openDatabase(path);
    try {
      expect(new MappingTerminationReads(createSqlitePorts(reopened)).get(mapping.id).termination!.stoppedIntents[0]!.attempts[0]!.error)
        .toEqual({ code: "CHANGED" });
    } finally { reopened.close(); }
  } finally { writer.close(); reader.close(); rmSync(directory, { recursive: true, force: true }); }
});
