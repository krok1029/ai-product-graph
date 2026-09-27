import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { durablePlaneProvider } from "../test-support/durable-plane-provider.js";
import { createPlaneCreateProcessor } from "./create-plane-create-processor.js";
import { planeExportPayload } from "./plane-export-payload.js";

let f: ReturnType<typeof acceptanceFixture>;
let provider: ReturnType<typeof durablePlaneProvider>;
let directory: string;
let now: number;
let intentId: string;
const clock = () => new Date(now);

beforeEach(() => {
  f = acceptanceFixture();
  directory = mkdtempSync(join(tmpdir(), "apg-enrollment-catch-up-"));
  provider = durablePlaneProvider(join(directory, "provider.sqlite"));
  now = Date.UTC(2026, 8, 27, 1);
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
  intentId = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: "create" }).syncIntent.id;
});
afterEach(() => { provider.close(); f.database.close(); rmSync(directory, { recursive: true, force: true }); });

it("factory always enrolls an in-flight new revision and done state in the successful mapping transaction", async () => {
  const original = f.ports.syncIntents.findById(intentId)!;
  let currentRevisionId = "";
  const processor = createPlaneCreateProcessor(f.ports, { ...provider.port, async create(request) {
    expect(f.database.inTransaction).toBe(false);
    currentRevisionId = replaceAndComplete();
    return provider.port.create(request);
  } }, { clock });
  expect(provider.calls()).toEqual([]);
  const completed = await processor.process(intentId, "worker");
  expect(completed.status).toBe("succeeded");
  expect(f.ports.syncIntents.findById(intentId)).toEqual(original);
  const mapping = f.ports.externalWorkItems.listTicketMappings(f.ticket.id)[0]!;
  expect(mapping).toMatchObject({ sourceTicketRevisionId: f.revision.id, nextSequenceNumber: 3 });
  const intents = mappingIntents();
  expect(intents.map(intent => [intent.operation, intent.sequenceNumber])).toEqual([["update", 1], ["close", 2]]);
  expect(intents[0]!.payload).toEqual(planeExportPayload(f.ports.ticketRevisions.findById(currentRevisionId)!));
  for (const intent of intents) {
    expect(intent).toMatchObject({ sourceTicketRevisionId: currentRevisionId,
      sourceEventType: "plane_mapping.created", sourceEventId: original.sourceEventId });
    expect(f.service.getSyncIntent(intent.id).requestState).toBe("pending");
    await expect(processor.process(intent.id, "worker")).rejects.toThrow();
  }
  expect((await processor.process(intentId, "again")).status).toBe("already_succeeded");
  expect(mappingIntents()).toEqual(intents);
  expect(provider.calls()).toEqual([{ operation: "create" }]);
  expect(f.database.pragma("foreign_key_check")).toEqual([]);
});

it("catches up done when revision is unchanged, and does not create a needless update", async () => {
  const processor = createPlaneCreateProcessor(f.ports, { ...provider.port, async create(request) {
    const result = f.submit().implementationResult;
    f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept" });
    return provider.port.create(request);
  } }, { clock });
  await processor.process(intentId, "worker");
  expect(mappingIntents().map(intent => intent.operation)).toEqual(["close"]);
});

it("catches up the latest desired state after create succeeds remotely but enrollment rolls back and restarts", async () => {
  let currentRevisionId = "";
  const processor = createPlaneCreateProcessor(f.ports, { ...provider.port, async create(request) {
    currentRevisionId = replaceAndComplete();
    return provider.port.create(request);
  } }, { clock });
  f.database.exec(`CREATE TRIGGER fail_catch_up BEFORE INSERT ON sync_intents WHEN NEW.mapping_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'catch-up failed'); END`);
  await expect(processor.process(intentId, "first", 1000)).rejects.toThrow("catch-up failed");
  expect(provider.count()).toBe(1);
  expect(f.ports.externalWorkItems.listTicketMappings(f.ticket.id)).toEqual([]);
  expect(mappingIntents()).toEqual([]);
  expect(f.ports.tickets.findById(f.ticket.id)!.deliveryStatus).toBe("done");
  f.database.exec("DROP TRIGGER fail_catch_up");
  const path = join(directory, "local.sqlite");
  await f.database.backup(path);
  now += 1001;
  provider.close();
  provider = durablePlaneProvider(join(directory, "provider.sqlite"));
  const reopened = openDatabase(path);
  try {
    const ports = createSqlitePorts(reopened);
    const recovered = createPlaneCreateProcessor(ports, provider.port, { clock });
    expect((await recovered.process(intentId, "restarted")).status).toBe("succeeded");
    expect(provider.calls()).toEqual([{ operation: "create" }, { operation: "reconcile" }]);
    const rows = reopened.prepare("SELECT operation, source_ticket_revision_id AS revision, sequence_number AS sequence FROM sync_intents WHERE mapping_id IS NOT NULL ORDER BY sequence_number").all();
    expect(rows).toEqual([{ operation: "update", revision: currentRevisionId, sequence: 1 }, { operation: "close", revision: currentRevisionId, sequence: 2 }]);
    expect(ports.syncIntents.listAttempts(intentId).map(attempt => attempt.resultStatus)).toEqual(["failed", "succeeded"]);
    expect(reopened.pragma("foreign_key_check")).toEqual([]);
  } finally { reopened.close(); }
});

function mappingIntents() {
  return (f.database.prepare("SELECT id FROM sync_intents WHERE mapping_id IS NOT NULL ORDER BY sequence_number").all() as { id: string }[])
    .map(row => f.ports.syncIntents.findById(row.id)!);
}
function replaceAndComplete() {
  const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
    sourceGraphRevisionId: f.graph.graphRevision.id, specification: { title: "New desired revision", userStory: "New story",
      scope: ["Feature"], acceptanceCriteria: ["Completed"], nonGoals: [], relatedGraphNodeIds: [f.goal],
      implementationTargets: f.revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope })), implementationNotes: [] } });
  const approved = f.service.approveTicketRevision(draft.revision.id);
  const target = approved.implementationTargets.targets[0]!;
  const brief = f.service.createImplementationBriefDraft({ implementationTargetId: target.id,
    repoContext: { repositoryName: "Repository 0", summary: "Context", fileList: ["src/app.ts"], moduleNotes: [], baselineCommitSha: "abc123", hasUncommittedChanges: false },
    brief: { implementationPlan: ["Implement"], suggestedFilesToInspect: [], testStrategy: ["Verify"], risks: [], prSummaryDraft: "Feature" } });
  f.service.approveImplementationBrief(brief.implementationBrief.id);
  const evidence = f.service.recordObservedEvidence({ projectId: f.project.id, repositoryId: target.repositoryId,
    evidenceType: "test_execution", idempotencyKey: "catch-up-evidence", payload: { schema_version: 1, command: "npm test", status: "passed", exit_code: 0,
      started_at: "2026-09-27T00:00:00.000Z", completed_at: "2026-09-27T00:01:00.000Z" } }).observedEvidence;
  const result = f.service.submitImplementationResult({ implementationBriefId: brief.implementationBrief.id,
    observedEvidenceIds: [evidence.id], summary: "Completed", unfinishedItems: [],
    criterionVerdicts: approved.revision.specification.acceptance_criteria.map(criterion => ({ acceptanceCriterionId: criterion.id,
      verdict: "satisfied", reason: "Verified", evidenceIds: [evidence.id] })) }).implementationResult;
  f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept-new" });
  return approved.revision.id;
}
