// 記錄使用者不採用外部差異的決策；不改原始 drift、Ticket、mapping 或同步義務。
import { z } from "zod";
import { ApplicationError } from "../domain/errors.js";
import type { Decision } from "../domain/result-acceptance.js";
import type { ContentDriftResolution } from "../domain/content-drift-resolution.js";
import type { ApplicationPorts } from "./ports.js";
import { readContentDriftResolution } from "./content-drift-resolution-support.js";

const rejectionCommand = z.object({ contentDriftId: z.string().trim().min(1), reason: z.string().trim().min(1) }).strict();
export type RejectContentDriftInput = z.input<typeof rejectionCommand>;

export class ContentDriftRejectionWorkflow {
  constructor(private readonly ports: ApplicationPorts, private readonly options: {
    idFactory: () => string; clock: () => Date; actor: { id: string; displayName: string };
  }) {}

  reject(input: RejectContentDriftInput) {
    const parsed = rejectionCommand.safeParse(input);
    if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Invalid Content Drift rejection command.", parsed.error.flatten());
    const command = parsed.data;
    return this.ports.transactions.run(() => {
      const now = this.options.clock().toISOString();
      // 先取得 writer lock；連同 actor 在內的所有新寫入於任何失敗時回滾。
      this.ports.localActors.ensure({ ...this.options.actor, createdAt: now, updatedAt: now });
      const { evidence, resolution } = readContentDriftResolution(this.ports, command.contentDriftId);
      if (resolution) throw new ApplicationError("CONFLICT", "Content Drift has already been resolved.", {
        resolution_id: resolution.record.id, decision_id: resolution.decision.id
      });
      const decision: Decision = { id: this.options.idFactory(), projectId: evidence.drift.projectId,
        decisionType: "content_drift_rejection", summary: command.reason, actorId: this.options.actor.id, createdAt: now };
      const record: ContentDriftResolution = { id: this.options.idFactory(), projectId: decision.projectId,
        contentDriftId: evidence.drift.id, decisionId: decision.id, kind: "reject", draftTicketRevisionId: null,
        auditLogId: this.options.idFactory() };
      this.ports.decisions.insert(decision);
      this.ports.auditLog.append({ id: record.auditLogId, projectId: record.projectId, actorType: "mcp_client",
        actorId: decision.actorId, action: "content_drift.rejected", entityType: "content_drift_resolution", entityId: record.id,
        beforeSummary: null, afterSummary: { contentDriftId: evidence.drift.id, snapshotId: evidence.snapshot.id,
          mappingId: evidence.mapping.id, ticketId: evidence.mapping.internalOwnerId,
          capturedSourceTicketRevisionId: evidence.observation.sourceTicketRevisionId, decisionId: decision.id },
        metadata: {}, createdAt: now });
      this.ports.contentDriftResolutions.insert(record);
      return { evidence, resolution: { record, decision, draft: null }, auditLogId: record.auditLogId };
    });
  }
}
