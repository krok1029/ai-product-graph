// 將可採取的下一步與交付證據一併讀出；此投影不改寫核准、驗收或工作狀態。
import type { Ticket } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import { stageProgress, summarizeDelivery } from "./stage-progress.js";
import { evaluateTicketSourceFreshness } from "./implementation-freshness.js";

export class DeliveryReads {
  constructor(private readonly ports: ApplicationPorts) {}

  ticket(ticket: Ticket) {
    const revision = ticket.currentApprovedRevisionId
      ? this.ports.ticketRevisions.findById(ticket.currentApprovedRevisionId) : null;
    const sourceProblem = revision ? evaluateTicketSourceFreshness(this.ports, ticket, revision) : null;
    const dependencies = revision?.specification.dependencies ?? [];
    const blockingDependencyIds = dependencies.filter(id => {
      const dependency = this.ports.tickets.findById(id);
      return !dependency || dependency.projectId !== ticket.projectId ||
        dependency.lifecycleStatus !== "active" || dependency.deliveryStatus !== "done";
    });
    const targets = this.ports.implementationTargets.listActiveByTicketId(ticket.id).map(target => {
      const approved = this.ports.implementationResults.findActiveApprovedByTargetId(target.id);
      const draft = this.ports.implementationResults.findLatestActiveDraftByTargetId(target.id);
      const acceptedResult = approved?.ticketRevisionId === revision?.id ? approved : null;
      const pendingResult = draft?.ticketRevisionId === revision?.id ? draft : null;
      const verdicts = pendingResult ? this.ports.implementationResults.listVerdicts(pendingResult.id) : [];
      const evidenceIds = new Set(pendingResult ? this.ports.implementationResults.listEvidenceIds(pendingResult.id) : []);
      const criteriaWithoutEvidence = acceptedResult && !pendingResult ? [] : (revision?.specification.acceptance_criteria ?? [])
        .filter(criterion => {
          const verdict = verdicts.find(entry => entry.acceptanceCriterionId === criterion.id);
          return !verdict || verdict.evidenceIds.length === 0 || verdict.evidenceIds.some(id => !evidenceIds.has(id));
        }).map(criterion => criterion.id);
      return {
        implementation_target_id: target.id, repository_id: target.repositoryId,
        approved_brief_id: this.ports.implementationBriefs.findActiveApprovedByTargetId(target.id)?.id ?? null,
        accepted_result_id: acceptedResult?.id ?? null, pending_result_id: pendingResult?.id ?? null,
        criteria_without_evidence: criteriaWithoutEvidence,
        unsatisfied_criterion_ids: verdicts.filter(verdict => verdict.verdict === "unsatisfied").map(verdict => verdict.acceptanceCriterionId)
      };
    });
    const nextAction = !revision ? "approve_ticket"
      : sourceProblem ? "reconcile_sources"
      : blockingDependencyIds.length ? "complete_dependencies"
      : ticket.deliveryStatus === "blocked" ? "resolve_blocker"
      : targets.some(target => target.pending_result_id) ? "review_result"
      : ticket.deliveryStatus === "done" ? "done"
      : "implement";
    return {
      ticket_id: ticket.id, title: ticket.title, delivery_status: ticket.deliveryStatus,
      approved_revision_id: revision?.id ?? null,
      source_freshness: !revision ? "unapproved" : sourceProblem ? "stale" : "current",
      source_problem: sourceProblem,
      dependency_ticket_ids: dependencies, blocking_dependency_ids: blockingDependencyIds,
      next_action: nextAction, targets
    };
  }

  project(projectId: string) {
    const tickets = this.ports.tickets.listByProjectId(projectId)
      .filter(ticket => ticket.lifecycleStatus === "active").map(ticket => this.ticket(ticket));
    return {
      scope: "active_project_tickets",
      summary: summarizeDelivery(tickets),
      stage_progress: stageProgress(this.ports, projectId, tickets),
      tickets
    };
  }
}
