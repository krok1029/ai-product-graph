// 採用只建立正常 Ticket 候選版本；外部原文、mapping 與既有交付保持不變。
import { z } from "zod";
import { ApplicationError } from "../domain/errors.js";
import type { Decision } from "../domain/result-acceptance.js";
import type { ContentDriftResolution } from "../domain/content-drift-resolution.js";
import type { ApplicationPorts } from "./ports.js";
import { readContentDriftResolution } from "./content-drift-resolution-support.js";
import { TicketWorkflow, type TicketSpecInput } from "./ticket-workflow.js";

const adoptionCommand = z.object({
  contentDriftId: z.string().trim().min(1), reason: z.string().trim().min(1),
  baseApprovedRevisionId: z.string().trim().min(1), sourceGraphRevisionId: z.string().trim().min(1),
  // 完整欄位驗證與正規化交由正常 Ticket workflow，MCP 另沿用既有 strict specification schema。
  specification: z.custom<TicketSpecInput>(value => typeof value === "object" && value !== null && !Array.isArray(value))
}).strict();
export type AdoptContentDriftInput = z.input<typeof adoptionCommand>;

export class ContentDriftAdoptionWorkflow {
  constructor(private readonly ports: ApplicationPorts, private readonly options: {
    idFactory: () => string; clock: () => Date; actor: { id: string; displayName: string };
  }) {}

  adopt(input: AdoptContentDriftInput) {
    const parsed = adoptionCommand.safeParse(input);
    if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Invalid Content Drift adoption command.", parsed.error.flatten());
    const command = parsed.data;
    return this.ports.transactions.run(() => {
      const eventTime = this.options.clock();
      const now = eventTime.toISOString();
      // 先取得 writer lock，防止讀取 base 後被另一連線搶先處置；所有失敗連同 actor 回滾。
      this.ports.localActors.ensure({ ...this.options.actor, createdAt: now, updatedAt: now });
      const { evidence, resolution } = readContentDriftResolution(this.ports, command.contentDriftId);
      if (resolution) throw new ApplicationError("CONFLICT", "Content Drift has already been resolved.", {
        resolution_id: resolution.record.id, decision_id: resolution.decision.id
      });
      if (!evidence.drift.diff.changes.some(change => change.field === "name" || change.field === "description_html")) {
        throw new ApplicationError("CONFLICT", "Marker-only Content Drift cannot form a Ticket specification draft.", {
          content_drift_id: evidence.drift.id, reason: "no_saved_specification_change"
        });
      }
      this.requireReconciledIntent(evidence.drift.projectId, command.sourceGraphRevisionId);
      // 只驗證候選來源，不要求舊 Ticket 新鮮；修復 stale Ticket 正是建立新版的用途。
      const created = new TicketWorkflow(this.ports, { ...this.options, clock: () => eventTime }).createRevisionDraft({
        ticketId: evidence.mapping.internalOwnerId, baseApprovedRevisionId: command.baseApprovedRevisionId,
        sourceGraphRevisionId: command.sourceGraphRevisionId, specification: command.specification
      });
      const decision: Decision = { id: this.options.idFactory(), projectId: evidence.drift.projectId,
        decisionType: "content_drift_adoption", summary: command.reason, actorId: this.options.actor.id, createdAt: now };
      const record: ContentDriftResolution = { id: this.options.idFactory(), projectId: decision.projectId,
        contentDriftId: evidence.drift.id, decisionId: decision.id, kind: "adopt", draftTicketRevisionId: created.revision.id,
        auditLogId: this.options.idFactory() };
      this.ports.decisions.insert(decision);
      this.ports.auditLog.append({ id: record.auditLogId, projectId: record.projectId, actorType: "mcp_client",
        actorId: decision.actorId, action: "content_drift.adopted", entityType: "content_drift_resolution", entityId: record.id,
        beforeSummary: null, afterSummary: { contentDriftId: evidence.drift.id, snapshotId: evidence.snapshot.id,
          mappingId: evidence.mapping.id, ticketId: evidence.mapping.internalOwnerId,
          capturedSourceTicketRevisionId: evidence.observation.sourceTicketRevisionId, decisionId: decision.id,
          draftTicketRevisionId: created.revision.id, baseApprovedRevisionId: created.revision.baseApprovedRevisionId,
          sourceGraphRevisionId: created.revision.sourceGraphRevisionId }, metadata: {}, createdAt: now });
      this.ports.contentDriftResolutions.insert(record);
      return { evidence, resolution: { record, decision, draft: created.revision },
        proposedImplementationTargets: created.proposedImplementationTargets, auditLogId: record.auditLogId };
    });
  }

  private requireReconciledIntent(projectId: string, sourceGraphRevisionId: string) {
    const project = this.ports.projects.findById(projectId);
    const brief = this.ports.productBriefs.findByProjectId(projectId);
    const version = brief?.currentApprovedVersionId ? this.ports.productBriefVersions.findById(brief.currentApprovedVersionId) : null;
    const intentGraph = project?.productIntentGraphRevisionId ? this.ports.graphRevisions.findById(project.productIntentGraphRevisionId) : null;
    const sourceGraph = this.ports.graphRevisions.findById(sourceGraphRevisionId);
    if (!project || project.lifecycleStatus !== "active" || !brief || brief.lifecycleStatus !== "active" ||
        !version || version.projectId !== projectId || version.productBriefId !== brief.id ||
        version.reviewStatus !== "approved" || version.lifecycleStatus !== "active" ||
        project.lastReconciledProductBriefVersionId !== version.id || !intentGraph || intentGraph.projectId !== projectId ||
        intentGraph.sourceProductBriefVersionId !== version.id || !sourceGraph || sourceGraph.projectId !== projectId ||
        sourceGraph.id !== project.currentGraphRevisionId || sourceGraph.sourceProductBriefVersionId !== version.id) {
      throw new ApplicationError("CONFLICT", "Content Drift adoption requires current, reconciled Product Intent.", {
        project_id: projectId, source_graph_revision_id: sourceGraphRevisionId, reason: "product_intent_unreconciled_or_stale"
      });
    }
  }
}
