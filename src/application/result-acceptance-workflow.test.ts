import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { ProductGraphService } from "./product-graph-service.js";
import { canonicalizeJson } from "./canonical-json.js";

const fixtures: ReturnType<typeof acceptanceFixture>[] = [];
function setup(targets = 1) {
  const fixture = acceptanceFixture(targets);
  fixtures.push(fixture);
  return fixture;
}
afterEach(() => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.database.close(); });

function accept(f: ReturnType<typeof setup>, id: string, key = "accept") {
  return f.service.acceptImplementationResult({ implementationResultId: id, idempotencyKey: key });
}
function count(f: ReturnType<typeof setup>, table: string) {
  return (f.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe("Result Acceptance", () => {
  it("rejects a result when its brief was superseded after submission", () => {
    const f = setup();
    const result = f.submit();
    replaceBrief(f);
    expect(() => accept(f, result.implementationResult.id)).toThrow(expect.objectContaining({ code: "STALE_HANDOFF" }));
    expect(count(f, "result_acceptances")).toBe(0);
    expect(count(f, "operation_receipts")).toBe(0);
    expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe("planned");
  });

  it("replays a successful acceptance after its source brief was superseded", () => {
    const f = setup();
    const result = f.submit();
    const original = accept(f, result.implementationResult.id);
    replaceBrief(f);
    expect(accept(f, result.implementationResult.id)).toEqual(original);
    expect(count(f, "result_acceptances")).toBe(1);
  });

  it("rejects an archived bound Product Brief Version without comparing current provenance pointers", () => {
    const f = setup();
    const result = f.submit();
    f.database.prepare("UPDATE product_brief_versions SET lifecycle_status = 'archived' WHERE id = ?")
      .run(f.productBrief.version.id);
    expect(() => accept(f, result.implementationResult.id)).toThrow(expect.objectContaining({ code: "STALE_HANDOFF" }));
    expect(count(f, "operation_receipts")).toBe(0);
  });

  it("completes only after all current required targets have accepted results", () => {
    const f = setup(2);
    const first = f.submit(0), second = f.submit(1);
    expect(accept(f, first.implementationResult.id, "first").data.ticket).toEqual({ id: f.ticket.id, delivery_status: "planned" });
    const accepted = accept(f, second.implementationResult.id, "second");
    expect(accepted.data.ticket).toEqual({ id: f.ticket.id, delivery_status: "done" });
    expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe("done");
  });

  it("preserves verdicts, orders waived outcomes and decisions, and uses one event time", () => {
    const f = setup();
    const result = f.submit(0, [0, 2]);
    const ids = f.revision.specification.acceptance_criteria.map(criterion => criterion.id);
    const before = f.ports.implementationResults.listVerdicts(result.implementationResult.id);
    const calls = f.clockCalls();
    const command = { implementationResultId: result.implementationResult.id, idempotencyKey: "waivers", waivers: [
      { acceptanceCriterionId: ids[2]!, reason: " Last exception " },
      { acceptanceCriterionId: ids[0]!, reason: " First exception " }
    ] };
    const response = f.service.acceptImplementationResult(command);
    expect(f.clockCalls()).toBe(calls + 1);
    const data = response.data as { result_acceptance: Record<string, string>; criterion_outcomes: Array<Record<string, unknown>>; waiver_decisions: Array<Record<string, unknown>> };
    expect(data.criterion_outcomes.map(outcome => outcome.acceptance_criterion_id)).toEqual(ids);
    expect(data.criterion_outcomes.map(outcome => outcome.outcome)).toEqual(["waived", "satisfied", "waived"]);
    expect(data.criterion_outcomes[1]?.waiver_decision_id).toBeNull();
    expect(data.waiver_decisions.map(decision => decision.summary)).toEqual(["First exception", "Last exception"]);
    for (const item of [...data.criterion_outcomes, ...data.waiver_decisions]) expect(item.created_at).toBe(data.result_acceptance.accepted_at);
    expect(data.waiver_decisions.every(decision => decision.actor_id === data.result_acceptance.actor_id)).toBe(true);
    expect(f.ports.implementationResults.listVerdicts(result.implementationResult.id)).toEqual(before);
    expect(f.service.acceptImplementationResult({ ...command, waivers: [...command.waivers].reverse() })).toEqual(response);
    const receipt = f.ports.operationReceipts.find(f.project.id, "acceptance-user", "accept_implementation_result", "waivers")!;
    expect(receipt.responseJson).toBe(canonicalizeJson(response.data));
    expect(receipt.normalizedCommandHash).toBe(createHash("sha256").update(receipt.normalizedCommandJson).digest("hex"));
    expect(JSON.parse(receipt.normalizedCommandJson)).toEqual({ implementation_result_id: result.implementationResult.id, waivers: [
      { acceptance_criterion_id: ids[0], reason: "First exception" }, { acceptance_criterion_id: ids[2], reason: "Last exception" }
    ] });
  });

  it("replays original data and audit after archival and reopening the service, before business validation", () => {
    const f = setup();
    const result = f.submit();
    const response = accept(f, result.implementationResult.id);
    f.ports.implementationResults.archive(result.implementationResult.id, "later");
    f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
    const service = new ProductGraphService(f.ports, { actor: { id: "acceptance-user", displayName: "Renamed" } });
    const audits = f.ports.auditLog.list().length;
    expect(service.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept" })).toEqual(response);
    expect(f.ports.auditLog.list()).toHaveLength(audits);
    expect(() => accept(f, result.implementationResult.id, "new-key")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(count(f, "operation_receipts")).toBe(1);
    expect(() => service.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept",
      waivers: [{ acceptanceCriterionId: "unknown", reason: "Changed" }] })).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    const otherActor = new ProductGraphService(f.ports, { actor: { id: "other", displayName: "Other" } });
    expect(() => otherActor.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept" })).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("resolves missing identity before receipt lookup", () => {
    const f = setup();
    const lookup = vi.spyOn(f.ports.operationReceipts, "find");
    expect(() => accept(f, "missing")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(lookup).not.toHaveBeenCalled();
    expect(count(f, "operation_receipts")).toBe(0);
  });

  it.each(["actorId", "acceptedAt", "approvedBy", "projectId"])("rejects client-owned %s fields", field => {
    const f = setup();
    const result = f.submit();
    expect(() => f.service.acceptImplementationResult({ implementationResultId: result.implementationResult.id,
      idempotencyKey: "accept", [field]: "forged" })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(count(f, "result_acceptances")).toBe(0);
  });

  it("requires evidence for satisfied verdicts and explicit waivers for unsatisfied criteria", () => {
    const f = setup();
    const noEvidence = f.submit(0, [], false);
    expect(() => accept(f, noEvidence.implementationResult.id)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    const unmet = f.submit(0, [0]);
    expect(() => accept(f, unmet.implementationResult.id)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(count(f, "operation_receipts")).toBe(0);
    const criterionId = f.revision.specification.acceptance_criteria[0]!.id;
    f.service.acceptImplementationResult({ implementationResultId: unmet.implementationResult.id, idempotencyKey: "accept",
      waivers: [{ acceptanceCriterionId: criterionId, reason: "Explicit exception" }] });
    expect(count(f, "operation_receipts")).toBe(1);
  });

  it.each(["satisfied", "unknown", "duplicate", "empty"])("rejects invalid %s waiver", kind => {
    const f = setup();
    const result = f.submit(0, [0]);
    const ids = f.revision.specification.acceptance_criteria.map(criterion => criterion.id);
    const waiver = { acceptanceCriterionId: kind === "satisfied" ? ids[1]! : kind === "unknown" ? "missing" : ids[0]!, reason: kind === "empty" ? " " : "Exception" };
    expect(() => f.service.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept",
      waivers: kind === "duplicate" ? [waiver, waiver] : [waiver] })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("rejects stale sources without a receipt and allows the same key after no-op reconciliation", () => {
    const f = setup();
    const result = f.submit();
    const draft = f.service.createProductBriefDraft({ projectId: f.project.id, sourceIdeaId: f.idea.id,
      baseApprovedVersionId: f.productBrief.version.id, brief: f.productBrief.version.brief });
    f.service.approveProductBriefVersion(draft.version.id);
    expect(() => accept(f, result.implementationResult.id)).toThrow(expect.objectContaining({ code: "STALE_HANDOFF" }));
    expect(count(f, "operation_receipts")).toBe(0);
    const batch = f.service.createGraphDraftBatch({ projectId: f.project.id, baseGraphRevisionId: f.graph.graphRevision.id,
      sourceProductBriefVersionId: draft.version.id, changes: [], reconciliationSummary: "No graph changes needed" });
    f.service.approveGraphDraftBatch(batch.graphDraftBatch.id);
    expect(accept(f, result.implementationResult.id).data.ticket).toEqual({ id: f.ticket.id, delivery_status: "done" });
  });

  it("atomically supersedes an approved result, archives draft attempts, and retains replay history", () => {
    const f = setup();
    const original = f.submit();
    const first = accept(f, original.implementationResult.id, "first");
    const missingLink = f.submit();
    expect(() => accept(f, missingLink.implementationResult.id, "missing-link")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    const replacement = f.submit(0, [], true, original.implementationResult.id);
    const sibling = f.submit(0, [], true, original.implementationResult.id);
    const response = accept(f, replacement.implementationResult.id, "second");
    expect(response.data.archived_result_ids).toEqual(expect.arrayContaining([original.implementationResult.id, sibling.implementationResult.id, missingLink.implementationResult.id]));
    expect(f.ports.implementationResults.findActiveApprovedByTargetId(replacement.implementationResult.implementationTargetId)?.id).toBe(replacement.implementationResult.id);
    expect(accept(f, original.implementationResult.id, "first")).toEqual(first);
    for (const table of ["operation_receipts", "result_acceptances", "implementation_results"]) {
      expect(() => f.database.prepare(`DELETE FROM ${table}`).run()).toThrow();
    }
  });

  it("rolls back all writes when receipt persistence fails and permits retry", () => {
    const f = setup();
    const result = f.submit(0, [0]);
    const sibling = f.submit();
    const command = { implementationResultId: result.implementationResult.id, idempotencyKey: "accept",
      waivers: [{ acceptanceCriterionId: f.revision.specification.acceptance_criteria[0]!.id, reason: "Exception" }] };
    const audits = f.ports.auditLog.list().length;
    const insert = vi.spyOn(f.ports.operationReceipts, "insert").mockImplementationOnce(() => { throw new Error("disk full"); });
    expect(() => f.service.acceptImplementationResult(command)).toThrow("disk full");
    for (const table of ["result_acceptances", "result_acceptance_criterion_outcomes", "decisions", "operation_receipts"]) expect(count(f, table)).toBe(0);
    expect(f.ports.implementationResults.findById(result.implementationResult.id)?.reviewStatus).toBe("draft");
    expect(f.ports.implementationResults.findById(sibling.implementationResult.id)?.lifecycleStatus).toBe("active");
    expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe("planned");
    expect(f.ports.auditLog.list()).toHaveLength(audits);
    insert.mockRestore();
    expect(f.service.acceptImplementationResult(command).data.ticket).toEqual({ id: f.ticket.id, delivery_status: "done" });
  });

  it.each(["missing", "empty-reason", "foreign-evidence"])("rejects invalid persisted %s verdicts", kind => {
    const f = setup();
    const result = f.submit();
    const verdict = result.criterionVerdicts[0]!;
    if (kind === "missing") f.database.prepare("DELETE FROM acceptance_criterion_verdicts WHERE id = ?").run(verdict.id);
    if (kind === "empty-reason") f.database.prepare("UPDATE acceptance_criterion_verdicts SET reason = ' ' WHERE id = ?").run(verdict.id);
    if (kind === "foreign-evidence") f.database.prepare("UPDATE acceptance_criterion_verdicts SET evidence_ids_json = '[\"foreign\"]' WHERE id = ?").run(verdict.id);
    expect(() => accept(f, result.implementationResult.id)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(count(f, "operation_receipts")).toBe(0);
  });

  it.each(["node-archived", "revision-not-current", "target-archived", "stale-submission"])("rejects %s results", kind => {
    const f = setup();
    const result = f.submit();
    if (kind === "node-archived") f.database.prepare("UPDATE graph_nodes SET lifecycle_status = 'archived' WHERE id = ?").run(f.goal);
    if (kind === "revision-not-current") f.database.prepare("UPDATE tickets SET current_approved_revision_id = NULL WHERE id = ?").run(f.ticket.id);
    if (kind === "target-archived") f.ports.implementationTargets.archive(result.implementationResult.implementationTargetId, "later");
    if (kind === "stale-submission") f.database.prepare("UPDATE implementation_results SET stale_at_submission = 1 WHERE id = ?").run(result.implementationResult.id);
    expect(() => accept(f, result.implementationResult.id)).toThrow(expect.objectContaining({ code: kind === "stale-submission" ? "CONFLICT" : "STALE_HANDOFF" }));
    expect(count(f, "operation_receipts")).toBe(0);
  });

});

function replaceBrief(f: ReturnType<typeof setup>) {
  const old = f.briefs[0]!;
  const replacement = f.service.createImplementationBriefDraft({
    implementationTargetId: old.implementationTargetId,
    supersedesImplementationBriefId: old.id,
    repoContext: { repositoryName: f.ports.repositoryContextSnapshots.findById(old.repositoryContextSnapshotId)!.context.repository_name, summary: "Updated plan", fileList: [],
      moduleNotes: [], baselineCommitSha: "abc123", hasUncommittedChanges: false },
    brief: { implementationPlan: ["Updated implementation plan"], suggestedFilesToInspect: [],
      testStrategy: ["Verify updated plan"], risks: [], prSummaryDraft: "Updated implementation" }
  });
  f.service.approveImplementationBrief(replacement.implementationBrief.id);
}
