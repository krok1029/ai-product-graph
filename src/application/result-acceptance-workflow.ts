import { createHash } from "node:crypto";
import { z } from "zod";
import { ApplicationError } from "../domain/errors.js";
import type { Decision, ResultAcceptance, ResultAcceptanceCriterionOutcome } from "../domain/result-acceptance.js";
import { canonicalizeJson } from "./canonical-json.js";
import type { ApplicationPorts } from "./ports.js";
import { requireAcceptanceSource, requireAcceptanceVerdicts } from "./result-acceptance-validation.js";

const acceptanceCommand = z.object({
  idempotencyKey: z.string().trim().min(1),
  implementationResultId: z.string().trim().min(1),
  waivers: z.array(z.object({
    acceptanceCriterionId: z.string().trim().min(1),
    reason: z.string().trim().min(1)
  }).strict()).default([])
}).strict();

export type AcceptImplementationResultInput = z.input<typeof acceptanceCommand>;

export class ResultAcceptanceWorkflow {
  constructor(private readonly ports: ApplicationPorts, private readonly options: {
    idFactory: () => string;
    clock: () => Date;
    actor: { id: string; displayName: string };
  }) {}

  accept(input: AcceptImplementationResultInput) {
    const parsed = acceptanceCommand.safeParse(input);
    if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Invalid acceptance command.", parsed.error.flatten());
    const command = parsed.data;
    return this.ports.transactions.run(() => {
      const now = this.options.clock().toISOString();
      // 先解析 identity，receipt 命中以前不得依目前 lifecycle 或來源狀態拒絕重試。
      const result = this.ports.implementationResults.findById(command.implementationResultId);
      if (!result) throw new ApplicationError("NOT_FOUND", "Implementation Result was not found.");
      const receipt = this.ports.operationReceipts.find(result.projectId, this.options.actor.id,
        "accept_implementation_result", command.idempotencyKey);
      const revision = this.ports.ticketRevisions.findById(result.ticketRevisionId);
      const criterionOrder = new Map(revision?.specification.acceptance_criteria.map((criterion, index) => [criterion.id, index]));
      const waivers = [...command.waivers].sort((left, right) =>
        (criterionOrder.get(left.acceptanceCriterionId) ?? Infinity) -
        (criterionOrder.get(right.acceptanceCriterionId) ?? Infinity));
      const normalizedCommandJson = canonicalizeJson({
        implementation_result_id: command.implementationResultId,
        waivers: waivers.map(waiver => ({ acceptance_criterion_id: waiver.acceptanceCriterionId, reason: waiver.reason }))
      });
      const normalizedCommandHash = createHash("sha256").update(normalizedCommandJson, "utf8").digest("hex");
      if (receipt) {
        if (receipt.normalizedCommandHash !== normalizedCommandHash) {
          throw new ApplicationError("CONFLICT", "Idempotency key was reused with a different command.");
        }
        return { data: JSON.parse(receipt.responseJson) as Record<string, unknown>, auditLogId: receipt.responseAuditLogId ?? undefined };
      }
      const source = requireAcceptanceSource(this.ports, result);
      const verified = requireAcceptanceVerdicts(this.ports, result, source.revision, source.target.repositoryId, waivers);
      const acceptance: ResultAcceptance = {
        id: this.options.idFactory(), projectId: result.projectId, implementationResultId: result.id,
        actorId: this.options.actor.id, acceptedAt: now
      };
      const decisions: Decision[] = [];
      const outcomes: ResultAcceptanceCriterionOutcome[] = verified.map(({ verdict, waiverReason }) => {
        let waiverDecisionId: string | null = null;
        if (waiverReason !== undefined) {
          waiverDecisionId = this.options.idFactory();
          decisions.push({ id: waiverDecisionId, projectId: result.projectId,
            decisionType: "acceptance_criterion_waiver", summary: waiverReason,
            actorId: acceptance.actorId, createdAt: now });
        }
        return { id: this.options.idFactory(), resultAcceptanceId: acceptance.id,
          acceptanceCriterionId: verdict.acceptanceCriterionId, submittedVerdictId: verdict.id,
          outcome: waiverDecisionId ? "waived" : "satisfied", waiverDecisionId, createdAt: now };
      });
      this.ports.localActors.ensure({ ...this.options.actor, createdAt: now, updatedAt: now });
      this.ports.resultAcceptances.insert(acceptance);
      for (const decision of decisions) this.ports.decisions.insert(decision);
      for (const outcome of outcomes) this.ports.resultAcceptances.insertOutcome(outcome);
      const archivedResultIds: string[] = [];
      if (source.current) {
        this.ports.implementationResults.archive(source.current.id, now);
        archivedResultIds.push(source.current.id);
      }
      archivedResultIds.push(...this.ports.implementationResults.archiveOtherDrafts(source.target.id, result.id, now));
      this.ports.implementationResults.approve(result.id, now);
      const complete = source.revision.requiredTargets.every(required => {
        const target = this.ports.implementationTargets.findActiveByTicketAndRepository(source.ticket.id, required.repository_id);
        const accepted = target && this.ports.implementationResults.findActiveApprovedByTargetId(target.id);
        return accepted?.ticketRevisionId === source.revision.id &&
          this.ports.resultAcceptances.findByResultId(accepted.id) !== null;
      });
      const deliveryStatus = complete ? "done" : source.ticket.deliveryStatus;
      if (deliveryStatus !== source.ticket.deliveryStatus) {
        this.ports.tickets.setDeliveryStatus(source.ticket.id, deliveryStatus, now);
      }
      const data = {
        implementation_result: { id: result.id, project_id: result.projectId, review_status: "approved", lifecycle_status: "active" },
        result_acceptance: { id: acceptance.id, project_id: acceptance.projectId,
          implementation_result_id: result.id, actor_id: acceptance.actorId, accepted_at: now },
        criterion_outcomes: outcomes.map(outcome => ({ id: outcome.id, result_acceptance_id: outcome.resultAcceptanceId,
          acceptance_criterion_id: outcome.acceptanceCriterionId, submitted_verdict_id: outcome.submittedVerdictId,
          outcome: outcome.outcome, waiver_decision_id: outcome.waiverDecisionId, created_at: now })),
        waiver_decisions: decisions.map(decision => ({ id: decision.id, project_id: decision.projectId,
          decision_type: decision.decisionType, summary: decision.summary, actor_id: decision.actorId, created_at: now })),
        archived_result_ids: archivedResultIds,
        ticket: { id: source.ticket.id, delivery_status: deliveryStatus }
      };
      const auditLogId = this.options.idFactory();
      this.ports.auditLog.append({ id: auditLogId, projectId: result.projectId,
        actorType: "mcp_client", actorId: acceptance.actorId, action: "implementation_result.accepted",
        entityType: "result_acceptance", entityId: acceptance.id,
        beforeSummary: { deliveryStatus: source.ticket.deliveryStatus }, afterSummary: data,
        metadata: {}, createdAt: now });
      const responseJson = canonicalizeJson(data);
      this.ports.operationReceipts.insert({ id: this.options.idFactory(), projectId: result.projectId,
        localActorId: acceptance.actorId, operationName: "accept_implementation_result", idempotencyKey: command.idempotencyKey,
        normalizedCommandHash, normalizedCommandJson, responseJson,
        responseAuditLogId: auditLogId, resultAcceptanceId: acceptance.id, resultRevocationId: null, createdAt: now });
      return { data: JSON.parse(responseJson) as Record<string, unknown>, auditLogId };
    });
  }
}
