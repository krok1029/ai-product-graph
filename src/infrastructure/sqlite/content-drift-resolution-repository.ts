// 以原始 association 查找，再驗證引用，不把斷鏈的已處置 drift 偽裝成未處置。
import type { ContentDriftResolutionRepository } from "../../application/content-drift-resolution-ports.js";
import type { ContentDriftResolution } from "../../domain/content-drift-resolution.js";
import { ApplicationError } from "../../domain/errors.js";
import type { Decision } from "../../domain/result-acceptance.js";
import type { SqliteDatabase } from "./database.js";
import { createTicketRepositories } from "./ticket-repositories.js";

export function createContentDriftResolutionRepository(database: SqliteDatabase): ContentDriftResolutionRepository {
  return {
    findByDriftId(contentDriftId) {
      const record = database.prepare(`SELECT id, project_id AS projectId, content_drift_id AS contentDriftId,
        decision_id AS decisionId, kind, draft_ticket_revision_id AS draftTicketRevisionId, audit_log_id AS auditLogId
        FROM content_drift_resolutions WHERE content_drift_id = ?`).get(contentDriftId) as ContentDriftResolution | undefined;
      if (!record) return null;
      const decision = database.prepare(`SELECT id, project_id AS projectId, decision_type AS decisionType,
        summary, actor_id AS actorId, created_at AS createdAt FROM decisions WHERE id = ?`)
        .get(record.decisionId) as Decision | undefined;
      if (!decision) invalid(contentDriftId);
      const audit = database.prepare(`SELECT a.before_summary_json AS beforeJson, a.after_summary_json AS afterJson,
        a.metadata_json AS metadataJson FROM audit_log a JOIN local_actors actor ON actor.id = a.actor_id
        WHERE a.id = ? AND a.project_id = ? AND a.actor_id = ? AND a.actor_type = 'mcp_client'
          AND a.created_at = ? AND a.entity_type = 'content_drift_resolution' AND a.entity_id = ? AND a.action = ?`)
        .get(record.auditLogId, record.projectId, decision.actorId, decision.createdAt, record.id,
          record.kind === "reject" ? "content_drift.rejected" : "content_drift.adopted") as
          { beforeJson: string | null; afterJson: string | null; metadataJson: string } | undefined;
      if (!audit) invalid(contentDriftId);
      for (const value of [audit.beforeJson, audit.afterJson, audit.metadataJson]) {
        if (value === null) continue;
        try { JSON.parse(value); } catch (error) { if (error instanceof SyntaxError) invalid(contentDriftId); throw error; }
      }
      let draft = null;
      if (record.draftTicketRevisionId !== null) {
        try { draft = createTicketRepositories(database).ticketRevisions.findById(record.draftTicketRevisionId); }
        catch (error) { if (error instanceof SyntaxError) invalid(contentDriftId); throw error; }
        if (!draft) invalid(contentDriftId);
      }
      return { record, decision, draft };
    },
    insert(record) {
      if (!database.inTransaction) throw new ApplicationError("STORAGE_ERROR", "Content Drift resolution requires a transaction.");
      database.prepare(`INSERT INTO content_drift_resolutions
        (id, project_id, content_drift_id, decision_id, kind, draft_ticket_revision_id, audit_log_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.projectId, record.contentDriftId,
          record.decisionId, record.kind, record.draftTicketRevisionId, record.auditLogId);
    }
  };
}
function invalid(contentDriftId: string): never {
  throw new ApplicationError("CONFLICT", "Content Drift resolution has inconsistent provenance.", { content_drift_id: contentDriftId });
}
