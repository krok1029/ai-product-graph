import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { canonicalizeJson } from "./canonical-json.js";
import { ProductGraphService } from "./product-graph-service.js";

const fixtures: ReturnType<typeof acceptanceFixture>[] = [];
function setup(targetCount = 1) {
  const f = acceptanceFixture(targetCount);
  fixtures.push(f);
  const result = f.submit();
  const accepted = f.service.acceptImplementationResult({
    implementationResultId: result.implementationResult.id, idempotencyKey: "shared-key"
  });
  const acceptance = f.ports.resultAcceptances.findByResultId(result.implementationResult.id)!;
  const command = { resultAcceptanceId: acceptance.id, idempotencyKey: "shared-key",
    reason: " The test evidence was invalid at acceptance. ",
    ...(targetCount === 1 ? { nextDeliveryStatus: "in_progress" as const } : {}) };
  return { ...f, result, accepted, acceptance, command, target: f.service };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) f.database.close();
});
function count(f: ReturnType<typeof setup>, table: string) {
  return (f.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe("Result Revocation", () => {
  it.each(["in_progress", "blocked"] as const)("revokes a done Ticket to %s and preserves acceptance, verdicts and evidence", status => {
    // 準備已驗收資料，保存不可變歷史以供比對。
    const f = setup();
    const beforeResult = f.ports.implementationResults.findById(f.result.implementationResult.id)!;
    const verdicts = f.ports.implementationResults.listVerdicts(beforeResult.id);
    const evidenceIds = f.ports.implementationResults.listEvidenceIds(beforeResult.id);
    const outcomes = f.database.prepare("SELECT * FROM result_acceptance_criterion_outcomes").all();
    const clockCalls = f.clockCalls();

    const response = f.target.revokeResultAcceptance({ ...f.command, nextDeliveryStatus: status });

    const revocation = f.ports.resultRevocations.findByAcceptanceId(f.acceptance.id)!;
    const decision = f.ports.decisions.findById(revocation.decisionId)!;
    expect(f.clockCalls()).toBe(clockCalls + 1);
    expect(revocation).toEqual({ id: revocation.id, projectId: f.project.id, resultAcceptanceId: f.acceptance.id,
      decisionId: decision.id, previousDeliveryStatus: "done", resultingDeliveryStatus: status });
    expect(decision).toEqual({ id: decision.id, projectId: f.project.id, decisionType: "result_acceptance_revocation",
      summary: f.command.reason.trim(), actorId: "acceptance-user", createdAt: decision.createdAt });
    expect(response.data).toEqual({
      implementation_result: { id: beforeResult.id, review_status: "approved", lifecycle_status: "archived" },
      result_revocation: { id: revocation.id, project_id: f.project.id, result_acceptance_id: f.acceptance.id,
        decision_id: decision.id, previous_delivery_status: "done", resulting_delivery_status: status },
      decision: { id: decision.id, project_id: f.project.id, decision_type: decision.decisionType,
        summary: decision.summary, actor_id: decision.actorId, created_at: decision.createdAt },
      ticket: { id: f.ticket.id, delivery_status: status }
    });
    expect(f.ports.implementationResults.findById(beforeResult.id)).toEqual({ ...beforeResult,
      lifecycleStatus: "archived", archivedAt: decision.createdAt, updatedAt: decision.createdAt });
    expect(f.ports.resultAcceptances.findById(f.acceptance.id)).toEqual(f.acceptance);
    expect(f.ports.implementationResults.listVerdicts(beforeResult.id)).toEqual(verdicts);
    expect(f.ports.implementationResults.listEvidenceIds(beforeResult.id)).toEqual(evidenceIds);
    expect(f.database.prepare("SELECT * FROM result_acceptance_criterion_outcomes").all()).toEqual(outcomes);
    expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe(status);
    expect(f.ports.auditLog.list().find(audit => audit.id === response.auditLogId)).toMatchObject({
      action: "result_acceptance.revoked", actorId: "acceptance-user", createdAt: decision.createdAt,
      beforeSummary: { deliveryStatus: "done" }, afterSummary: response.data
    });
  });

  it.each(["planned", "in_progress", "blocked"] as const)("preserves unfinished multi-target Ticket status %s", status => {
    const f = setup(2);
    f.ports.tickets.setDeliveryStatus(f.ticket.id, status, "before-revocation");
    const beforeTicket = f.ports.tickets.findById(f.ticket.id);

    expect(() => f.target.revokeResultAcceptance({ ...f.command, nextDeliveryStatus: "blocked" }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    const response = f.target.revokeResultAcceptance(f.command);

    expect(f.ports.tickets.findById(f.ticket.id)).toEqual(beforeTicket);
    expect(response.data.result_revocation).toMatchObject({ previous_delivery_status: status, resulting_delivery_status: status });
    expect(count(f, "result_revocations")).toBe(1);
  });

  it("requires done rollback status without consuming a failed key", () => {
    const f = setup();
    const { nextDeliveryStatus: _, ...missingStatus } = f.command;

    expect(() => f.target.revokeResultAcceptance(missingStatus)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));

    expect(f.ports.operationReceipts.find(f.project.id, "acceptance-user", "revoke_result_acceptance", f.command.idempotencyKey)).toBeNull();
    expect(count(f, "result_revocations")).toBe(0);
    expect(f.target.revokeResultAcceptance(f.command).data.ticket).toEqual({ id: f.ticket.id, delivery_status: "in_progress" });
  });

  it("replays exact response and audit after later archival and correction using an operation-scoped key", () => {
    const f = setup();
    const original = f.target.revokeResultAcceptance(f.command);
    const correction = f.submit();
    f.target.acceptImplementationResult({ implementationResultId: correction.implementationResult.id, idempotencyKey: "correction" });
    f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
    const target = new ProductGraphService(f.ports, { actor: { id: "acceptance-user", displayName: "Renamed" } });
    const audits = f.ports.auditLog.list().length;
    const writes = vi.spyOn(f.ports.implementationResults, "archive");

    expect(target.revokeResultAcceptance({ ...f.command, reason: f.command.reason.trim() })).toEqual(original);

    expect(writes).not.toHaveBeenCalled();
    expect(f.ports.auditLog.list()).toHaveLength(audits);
    expect(count(f, "result_revocations")).toBe(1);
    expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe("done");
    const receipt = f.ports.operationReceipts.find(f.project.id, "acceptance-user", "revoke_result_acceptance", "shared-key")!;
    expect(receipt.resultAcceptanceId).toBeNull();
    expect(receipt.resultRevocationId).toBe(f.ports.resultRevocations.findByAcceptanceId(f.acceptance.id)!.id);
    expect(receipt.responseJson).toBe(canonicalizeJson(original.data));
    expect(receipt.responseAuditLogId).toBe(original.auditLogId);
    expect(receipt.normalizedCommandJson).toBe(canonicalizeJson({ result_acceptance_id: f.acceptance.id,
      reason: f.command.reason.trim(), next_delivery_status: "in_progress" }));
    expect(receipt.normalizedCommandHash).toBe(createHash("sha256").update(receipt.normalizedCommandJson).digest("hex"));
    expect(target.acceptImplementationResult({ implementationResultId: f.result.implementationResult.id,
      idempotencyKey: "shared-key" })).toEqual(f.accepted);
  });

  it("conflicts for changed commands, another key, or another actor after revocation", () => {
    const f = setup();
    f.target.revokeResultAcceptance(f.command);
    const anotherActor = new ProductGraphService(f.ports, { actor: { id: "other", displayName: "Other" } });

    for (const command of [
      { ...f.command, reason: "A different reason" },
      { ...f.command, nextDeliveryStatus: "blocked" as const },
      { resultAcceptanceId: f.acceptance.id, idempotencyKey: "shared-key", reason: f.command.reason },
      { ...f.command, idempotencyKey: "different-key" }
    ]) expect(() => f.target.revokeResultAcceptance(command)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(() => anotherActor.revokeResultAcceptance(f.command)).toThrow(expect.objectContaining({ code: "CONFLICT" }));

    expect(count(f, "operation_receipts")).toBe(2);
    expect(count(f, "result_revocations")).toBe(1);
  });

  it("resolves missing acceptance before receipt lookup and rejects Result identity as substitute", () => {
    const f = setup();
    const lookup = vi.spyOn(f.ports.operationReceipts, "find");

    for (const id of ["missing", f.result.implementationResult.id]) {
      expect(() => f.target.revokeResultAcceptance({ ...f.command, resultAcceptanceId: id }))
        .toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    }

    expect(lookup).not.toHaveBeenCalled();
    expect(count(f, "result_revocations")).toBe(0);
  });

  it.each(["projectId", "actorId", "createdAt", "implementationResultId", "decisionId", "previousDeliveryStatus"])("rejects injected %s", field => {
    const f = setup();
    expect(() => f.target.revokeResultAcceptance({ ...f.command, [field]: "forged" }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(count(f, "result_revocations")).toBe(0);
  });

  it.each(["", " "])("rejects blank reason %j without creating a receipt", reason => {
    const f = setup();
    expect(() => f.target.revokeResultAcceptance({ ...f.command, reason }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(count(f, "operation_receipts")).toBe(1);
  });

  it("allows revocation of still-effective approval when product intent is stale", () => {
    const f = setup();
    const draft = f.target.createProductBriefDraft({ projectId: f.project.id, sourceIdeaId: f.idea.id,
      baseApprovedVersionId: f.productBrief.version.id, brief: f.productBrief.version.brief });
    f.target.approveProductBriefVersion(draft.version.id);

    const response = f.target.revokeResultAcceptance(f.command);

    expect(response.data.ticket).toEqual({ id: f.ticket.id, delivery_status: "in_progress" });
  });

  it("rejects superseded approved Result acceptance without consuming a key", () => {
    const f = setup();
    const replacement = f.submit(0, [], true, f.result.implementationResult.id);
    f.target.acceptImplementationResult({ implementationResultId: replacement.implementationResult.id, idempotencyKey: "replacement" });

    expect(() => f.target.revokeResultAcceptance(f.command)).toThrow(expect.objectContaining({ code: "CONFLICT" }));

    expect(count(f, "result_revocations")).toBe(0);
    expect(f.ports.tickets.findById(f.ticket.id)?.deliveryStatus).toBe("done");
  });

  it("rolls back Decision, revocation, archival, status and audit on storage failure and retries", () => {
    const f = setup();
    const audits = f.ports.auditLog.list();
    const beforeResult = f.ports.implementationResults.findById(f.result.implementationResult.id);
    const beforeTicket = f.ports.tickets.findById(f.ticket.id);
    vi.spyOn(f.ports.operationReceipts, "insert").mockImplementationOnce(() => { throw new Error("disk full"); });

    expect(() => f.target.revokeResultAcceptance(f.command)).toThrow("disk full");

    expect(count(f, "decisions")).toBe(0);
    expect(count(f, "result_revocations")).toBe(0);
    expect(count(f, "operation_receipts")).toBe(1);
    expect(f.ports.implementationResults.findById(f.result.implementationResult.id)).toEqual(beforeResult);
    expect(f.ports.tickets.findById(f.ticket.id)).toEqual(beforeTicket);
    expect(f.ports.auditLog.list()).toEqual(audits);
    expect(f.target.revokeResultAcceptance(f.command).data.ticket).toEqual({ id: f.ticket.id, delivery_status: "in_progress" });
  });

  it("permanently retains revoked history and requires a new Result for correction", () => {
    const f = setup();
    f.target.revokeResultAcceptance(f.command);

    expect(() => f.target.acceptImplementationResult({ implementationResultId: f.result.implementationResult.id,
      idempotencyKey: "reaccept" })).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    for (const table of ["operation_receipts", "result_acceptances", "result_revocations", "implementation_results"]) {
      expect(() => f.database.prepare(`DELETE FROM ${table}`).run()).toThrow();
    }
    const corrected = f.submit();
    const accepted = f.target.acceptImplementationResult({ implementationResultId: corrected.implementationResult.id,
      idempotencyKey: "correction" });

    expect(accepted.data.ticket).toEqual({ id: f.ticket.id, delivery_status: "done" });
    expect(f.ports.implementationResults.findById(f.result.implementationResult.id)?.lifecycleStatus).toBe("archived");
    expect(count(f, "result_acceptances")).toBe(2);
    expect(count(f, "result_revocations")).toBe(1);
  });
});
