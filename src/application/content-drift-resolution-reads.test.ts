// 查詢使用真實 SQLite 證據；不呼叫 provider，也不以目前 revision 重新推算歷史。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { planeObservationHistoryFixture } from "../test-support/plane-observation-history-fixture.js";
import { ProductGraphService } from "./product-graph-service.js";

let f: Awaited<ReturnType<typeof planeObservationHistoryFixture>>;
beforeEach(async () => { f = await planeObservationHistoryFixture(); });
afterEach(() => { vi.restoreAllMocks(); f.database.close(); });

it("distinguishes unresolved from missing without clock, actor or ID creation", () => {
  const captured = f.capture();
  const forbidden = vi.fn((): never => { throw new Error("Read attempted a mutation"); });
  const target = new ProductGraphService(f.ports, { clock: forbidden, idFactory: forbidden });
  const before = f.allRows();

  const result = target.getContentDriftResolution(captured.drift!.id);

  expect(result).toEqual({ evidence: { mapping: f.mapping, drift: captured.drift,
    snapshot: captured.snapshot, observation: captured.provenance }, resolution: null });
  expect(() => target.getContentDriftResolution("missing")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  expect(forbidden).not.toHaveBeenCalled();
  expect(f.allRows()).toEqual(before);
});

it("reads only the selected drift despite an unrelated corrupt observation and sync attempt", () => {
  const selected = f.capture({ id: "selected" });
  f.capture({ id: "unrelated" });
  disableGuards();
  f.database.exec("UPDATE external_work_item_snapshots SET content_json = '{' WHERE id = 'unrelated'");
  f.database.exec("UPDATE sync_attempts SET response_json = '{'");
  const before = f.allRows();

  const result = f.service.getContentDriftResolution(selected.drift!.id);

  expect(result.evidence.drift).toEqual(selected.drift);
  expect(result.resolution).toBeNull();
  expect(() => f.service.getMappingContentDriftHistory(f.mapping.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(f.allRows()).toEqual(before);
});

it("keeps rejection provenance readable after revision changes, mapping termination and owner archival", () => {
  const captured = f.capture();
  const rejected = f.service.rejectContentDrift({ contentDriftId: captured.drift!.id, reason: "保留本機內容" });
  const originalDrift = f.database.prepare("SELECT * FROM content_drifts").all();
  f.replaceRevision();
  f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "停止後續同步" });
  f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
  f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
  const before = f.allRows();

  const result = f.service.getContentDriftResolution(captured.drift!.id);
  const history = f.service.getMappingContentDriftHistory(f.mapping.id);

  expect(result.resolution).toEqual(rejected.resolution);
  expect(result.resolution).toMatchObject({ record: { kind: "reject" }, draft: null,
    decision: { summary: "保留本機內容", actorId: "acceptance-user" } });
  expect(history.drifts[0]).toEqual({ ...captured.drift,
    resolutionDecisionId: rejected.resolution!.decision.id, resolution: rejected.resolution });
  expect(f.database.prepare("SELECT * FROM content_drifts").all()).toEqual(originalDrift);
  expect(f.allRows()).toEqual(before);
});

it("reads every history resolution under the same transaction and preserves ordering", () => {
  const second = f.capture({ id: "b" });
  const first = f.capture({ id: "a" });
  f.service.rejectContentDrift({ contentDriftId: second.drift!.id, reason: "保留" });
  const read = f.ports.planeObservationReads.readDrift.bind(f.ports.planeObservationReads);
  const transactions: boolean[] = [];
  vi.spyOn(f.ports.planeObservationReads, "readDrift").mockImplementation(id => {
    transactions.push(f.database.inTransaction);
    return read(id);
  });
  const before = f.allRows();

  const result = f.service.getMappingContentDriftHistory(f.mapping.id);

  expect(result.drifts.map(drift => drift.id)).toEqual([first.drift!.id, second.drift!.id]);
  expect(result.drifts.map(drift => drift.resolution?.record.kind ?? null)).toEqual([null, "reject"]);
  expect(transactions).toEqual([true, true]);
  expect(f.allRows()).toEqual(before);
});

it("propagates unexpected storage failures without disguising them as unresolved or corruption", () => {
  const captured = f.capture();
  const failure = new Error("unexpected storage failure");
  vi.spyOn(f.ports.contentDriftResolutions, "findByDriftId").mockImplementation(() => { throw failure; });

  expect(() => f.service.getContentDriftResolution(captured.drift!.id)).toThrow(failure);
});

function disableGuards() {
  // 僅在此測試模擬既有資料損壞，不變更正式 write guards。
  f.database.pragma("foreign_keys = OFF");
  const triggers = f.database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[];
  for (const { name } of triggers) f.database.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
}
