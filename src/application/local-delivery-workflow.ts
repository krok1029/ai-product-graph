// 本機交付以較少呼叫組合既有規則；版本、核准及 evidence 驗證仍由原 workflow 負責。
import { ApplicationError } from "../domain/errors.js";
import type { ApplicationPorts } from "./ports.js";
import { ImplementationWorkflow } from "./implementation-workflow.js";
import { ImplementationResultWorkflow } from "./implementation-result-workflow.js";
import { ProjectReads } from "./project-reads.js";
import { TicketReads } from "./ticket-reads.js";
import { DeliveryReads } from "./delivery-reads.js";

type Options = {
  idFactory: () => string;
  clock: () => Date;
  actor: { id: string; displayName: string };
};
type EvidenceInput = Omit<Parameters<ImplementationResultWorkflow["recordObservedEvidence"]>[0], "projectId" | "repositoryId">;
export type DeliverySubmission = {
  implementationBriefId: string;
  supersedesImplementationResultId?: string | null;
  evidence: Array<EvidenceInput & { ref: string }>;
  observedEvidenceIds: string[];
  summary: string;
  criterionVerdicts: Array<{
    acceptanceCriterionId: string;
    verdict: "satisfied" | "unsatisfied";
    reason: string;
    evidenceRefs: string[];
    evidenceIds: string[];
  }>;
  unfinishedItems: string[];
};

export class LocalDeliveryWorkflow {
  private readonly implementation: ImplementationWorkflow;
  private readonly results: ImplementationResultWorkflow;

  constructor(private readonly ports: ApplicationPorts, private readonly options: Options) {
    this.implementation = new ImplementationWorkflow(ports, options);
    this.results = new ImplementationResultWorkflow(ports, options);
  }

  getContext(ticketId: string) {
    return this.ports.transactions.run(() => {
      const context = new TicketReads(this.ports).getContext({ ticketId });
      const product = new ProjectReads(this.ports).getBrief(context.ticket.projectId);
      const targets = this.ports.implementationTargets.listActiveByTicketId(ticketId).map(target => {
        const repository = this.ports.repositories.findById(target.repositoryId);
        if (!repository || repository.projectId !== context.ticket.projectId || target.projectId !== context.ticket.projectId) {
          throw new ApplicationError("STORAGE_ERROR", "Implementation Target repository scope is inconsistent.");
        }
        return {
          target, repository,
          approvedBrief: this.ports.implementationBriefs.findActiveApprovedByTargetId(target.id),
          pendingResult: this.ports.implementationResults.findLatestActiveDraftByTargetId(target.id),
          acceptedResult: this.ports.implementationResults.findActiveApprovedByTargetId(target.id)
        };
      });
      return { ...context, ...product, targets, delivery: new DeliveryReads(this.ports).ticket(context.ticket) };
    });
  }

  getProjectDelivery(projectId: string) {
    return this.ports.transactions.run(() => new DeliveryReads(this.ports).project(projectId));
  }

  start(input: Parameters<ImplementationWorkflow["getHandoff"]>[0]) {
    const brief = this.ports.implementationBriefs.findById(input.implementationBriefId);
    if (!brief) throw new ApplicationError("NOT_FOUND", "Implementation Brief was not found.");
    try {
      return this.ports.transactions.run(() => {
        // 已核准的 brief 可用同一入口重新驗證；只有 draft 需要保存使用者核准。
        if (brief.reviewStatus === "draft" && brief.lifecycleStatus === "active") {
          this.implementation.approveBrief(brief.id);
        }
        return this.implementation.getHandoff(input);
      });
    } catch (error) {
      // 失敗時核准 rollback，仍保留被阻擋的 handoff 嘗試；不記錄 client repository fingerprint。
      if (error instanceof ApplicationError && error.code === "STALE_HANDOFF") {
        const now = this.options.clock().toISOString();
        const details = error.details;
        const reason = details && typeof details === "object" && "reason" in details && typeof details.reason === "string"
          ? details.reason : "source_unverifiable";
        this.ports.transactions.run(() => {
          this.ports.localActors.ensure({ ...this.options.actor, createdAt: now, updatedAt: now });
          this.ports.auditLog.append({
            id: this.options.idFactory(), projectId: brief.projectId,
            actorType: "mcp_client", actorId: this.options.actor.id,
            action: "implementation_handoff.blocked", entityType: "implementation_brief", entityId: brief.id,
            beforeSummary: null, afterSummary: { freshness: "stale", reason },
            metadata: {}, createdAt: now
          });
        });
      }
      throw error;
    }
  }

  submit(input: DeliverySubmission) {
    return this.ports.transactions.run(() => {
      const brief = this.ports.implementationBriefs.findById(input.implementationBriefId);
      if (!brief) throw new ApplicationError("NOT_FOUND", "Implementation Brief was not found.");
      const target = this.ports.implementationTargets.findById(brief.implementationTargetId);
      if (!target || target.projectId !== brief.projectId) {
        throw new ApplicationError("CONFLICT", "Implementation Target scope is inconsistent.");
      }
      const references = new Map<string, string>();
      for (const entry of input.evidence) {
        const ref = entry.ref.trim();
        if (!ref || references.has(ref)) {
          throw new ApplicationError("VALIDATION_ERROR", "Evidence refs must be nonempty and unique.");
        }
        const recorded = this.results.recordObservedEvidence({
          projectId: brief.projectId, repositoryId: target.repositoryId,
          evidenceType: entry.evidenceType, idempotencyKey: entry.idempotencyKey, payload: entry.payload
        });
        references.set(ref, recorded.observedEvidence.id);
      }
      const observedEvidenceIds = [...new Set([...input.observedEvidenceIds, ...references.values()])];
      const criterionVerdicts = input.criterionVerdicts.map(verdict => ({
        acceptanceCriterionId: verdict.acceptanceCriterionId,
        verdict: verdict.verdict, reason: verdict.reason,
        evidenceIds: [...new Set([...verdict.evidenceIds, ...verdict.evidenceRefs.map(ref => {
          const id = references.get(ref.trim());
          if (!id) throw new ApplicationError("VALIDATION_ERROR", "Unknown evidence ref.", { ref });
          return id;
        })])]
      }));
      // Result 驗證失敗會一起 rollback 本次新 evidence；stale Result 仍依原規則保存為 archived。
      return this.results.submitResult({
        implementationBriefId: brief.id,
        supersedesImplementationResultId: input.supersedesImplementationResultId,
        observedEvidenceIds, summary: input.summary, criterionVerdicts, unfinishedItems: input.unfinishedItems
      });
    });
  }
}
