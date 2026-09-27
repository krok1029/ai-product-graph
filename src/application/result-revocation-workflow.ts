import { createHash } from "node:crypto";
import { z } from "zod";
import { ApplicationError } from "../domain/errors.js";
import type { Decision, ResultRevocation } from "../domain/result-acceptance.js";
import { canonicalizeJson } from "./canonical-json.js";
import type { ApplicationPorts } from "./ports.js";

const revocationCommand = z.object({
  idempotencyKey: z.string().trim().min(1),
  resultAcceptanceId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  nextDeliveryStatus: z.enum(["in_progress", "blocked"]).optional()
}).strict();

export type RevokeResultAcceptanceInput = z.input<typeof revocationCommand>;

export class ResultRevocationWorkflow {
  constructor(private readonly ports: ApplicationPorts, private readonly options: {
    idFactory: () => string;
    clock: () => Date;
    actor: { id: string; displayName: string };
  }) {}

  revoke(input: RevokeResultAcceptanceInput) {
    const parsed = revocationCommand.safeParse(input);
    if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Invalid revocation command.", parsed.error.flatten());
    const command = parsed.data;
    const normalizedCommandJson = canonicalizeJson({
      result_acceptance_id: command.resultAcceptanceId,
      reason: command.reason,
      ...(command.nextDeliveryStatus === undefined ? {} : { next_delivery_status: command.nextDeliveryStatus })
    });
    const normalizedCommandHash = createHash("sha256").update(normalizedCommandJson, "utf8").digest("hex");
    return this.ports.transactions.run(() => {
      // 只解析 Acceptance identity 與 Project scope，receipt replay 不受後來狀態變更影響。
      const acceptance = this.ports.resultAcceptances.findById(command.resultAcceptanceId);
      if (!acceptance) throw new ApplicationError("NOT_FOUND", "Result Acceptance was not found.");
      const receipt = this.ports.operationReceipts.find(acceptance.projectId, this.options.actor.id,
        "revoke_result_acceptance", command.idempotencyKey);
      if (receipt) {
        if (receipt.normalizedCommandHash !== normalizedCommandHash) {
          throw new ApplicationError("CONFLICT", "Idempotency key was reused with a different command.");
        }
        return { data: JSON.parse(receipt.responseJson) as Record<string, unknown>, auditLogId: receipt.responseAuditLogId ?? undefined };
      }
      const result = this.ports.implementationResults.findById(acceptance.implementationResultId);
      const target = result && this.ports.implementationTargets.findById(result.implementationTargetId);
      const ticket = target && this.ports.tickets.findById(target.ticketId);
      if (!acceptance.projectId || !result || !target || !ticket ||
          result.lifecycleStatus !== "active" || result.reviewStatus !== "approved" ||
          [result, target, ticket].some(entity => entity.projectId !== acceptance.projectId) ||
          target.lifecycleStatus !== "active" || ticket.currentApprovedRevisionId !== result.ticketRevisionId ||
          this.ports.resultRevocations.findByAcceptanceId(acceptance.id)) {
        throw new ApplicationError("CONFLICT", "Acceptance must still apply to an active approved Result.");
      }
      // 撤銷修正的是當時的驗收判斷；目前產品來源 freshness 不影響撤銷資格。
      if (ticket.deliveryStatus === "done" && command.nextDeliveryStatus === undefined) {
        throw new ApplicationError("VALIDATION_ERROR", "A done Ticket requires next_delivery_status.");
      }
      if (ticket.deliveryStatus !== "done" && command.nextDeliveryStatus !== undefined) {
        throw new ApplicationError("VALIDATION_ERROR", "An unfinished Ticket must omit next_delivery_status.");
      }
      const now = this.options.clock().toISOString();
      const resultingStatus = command.nextDeliveryStatus ?? ticket.deliveryStatus;
      const decision: Decision = {
        id: this.options.idFactory(), projectId: acceptance.projectId,
        decisionType: "result_acceptance_revocation", summary: command.reason,
        actorId: this.options.actor.id, createdAt: now
      };
      const revocation: ResultRevocation = {
        id: this.options.idFactory(), projectId: acceptance.projectId,
        resultAcceptanceId: acceptance.id, decisionId: decision.id,
        previousDeliveryStatus: ticket.deliveryStatus, resultingDeliveryStatus: resultingStatus
      };
      this.ports.localActors.ensure({ ...this.options.actor, createdAt: now, updatedAt: now });
      this.ports.decisions.insert(decision);
      this.ports.resultRevocations.insert(revocation);
      this.ports.implementationResults.archive(result.id, now);
      if (resultingStatus !== ticket.deliveryStatus) this.ports.tickets.setDeliveryStatus(ticket.id, resultingStatus, now);
      const data = {
        implementation_result: { id: result.id, review_status: "approved", lifecycle_status: "archived" },
        result_revocation: { id: revocation.id, project_id: revocation.projectId,
          result_acceptance_id: acceptance.id, decision_id: decision.id,
          previous_delivery_status: revocation.previousDeliveryStatus, resulting_delivery_status: resultingStatus },
        decision: { id: decision.id, project_id: decision.projectId, decision_type: decision.decisionType,
          summary: decision.summary, actor_id: decision.actorId, created_at: now },
        ticket: { id: ticket.id, delivery_status: resultingStatus }
      };
      const auditLogId = this.options.idFactory();
      this.ports.auditLog.append({ id: auditLogId, projectId: acceptance.projectId,
        actorType: "mcp_client", actorId: decision.actorId, action: "result_acceptance.revoked",
        entityType: "result_revocation", entityId: revocation.id,
        beforeSummary: { deliveryStatus: ticket.deliveryStatus }, afterSummary: data,
        metadata: {}, createdAt: now });
      const responseJson = canonicalizeJson(data);
      this.ports.operationReceipts.insert({ id: this.options.idFactory(), projectId: acceptance.projectId,
        localActorId: decision.actorId, operationName: "revoke_result_acceptance", idempotencyKey: command.idempotencyKey,
        normalizedCommandHash, normalizedCommandJson, responseJson,
        responseAuditLogId: auditLogId, resultAcceptanceId: null, resultRevocationId: revocation.id, createdAt: now });
      return { data: JSON.parse(responseJson) as Record<string, unknown>, auditLogId };
    });
  }
}
