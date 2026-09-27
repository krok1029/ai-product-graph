// Implementation handoff persistence adapter。
//
// Implementation handoff artifacts 的 SQLite adapter。這些紀錄刻意採
// versioned、append-oriented 方式保存，讓 approved handoff 在後續被替換後
// 仍然可以被稽核追溯。

import type { ApplicationPorts } from "../../application/ports.js";
import type { SqliteDatabase } from "./database.js";
import {
  mapImplementationBrief,
  mapImplementationResult,
  mapImplementationTarget,
  mapObservedEvidence,
  mapRepositoryContextSnapshot,
  type ImplementationBriefRow,
  type ImplementationResultRow,
  type ImplementationTargetRow,
  type ObservedEvidenceRow,
  type RepositoryContextSnapshotRow
} from "./row-mappers.js";

export function createImplementationRepositories(
  database: SqliteDatabase
): Pick<
  ApplicationPorts,
  | "implementationTargets"
  | "repositoryContextSnapshots"
  | "implementationBriefs"
  | "observedEvidence"
  | "implementationResults"
  | "implementationArtifacts"
> {
  return {
    implementationTargets: {
      insert(target) {
        database
          .prepare(
            `INSERT INTO implementation_targets (
          id, project_id, ticket_id, repository_id, lifecycle_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            target.id,
            target.projectId,
            target.ticketId,
            target.repositoryId,
            target.lifecycleStatus,
            target.createdAt,
            target.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, ticket_id, repository_id,
                lifecycle_status, created_at, updated_at
         FROM implementation_targets WHERE id = ?`
          )
          .get(id) as ImplementationTargetRow|undefined;
        return row? mapImplementationTarget(row):null;
      },
      findActiveByTicketAndRepository(ticketId, repositoryId) {
        const row = database
          .prepare(
            `SELECT id, project_id, ticket_id, repository_id,
                lifecycle_status, created_at, updated_at
         FROM implementation_targets
         WHERE ticket_id = ?
           AND repository_id = ?
           AND lifecycle_status = 'active'`
          )
          .get(ticketId, repositoryId) as ImplementationTargetRow|undefined;
        return row? mapImplementationTarget(row):null;
      },
      listActiveByTicketId(ticketId) {
        const rows = database
          .prepare(
            `SELECT id, project_id, ticket_id, repository_id,
                lifecycle_status, created_at, updated_at
         FROM implementation_targets
         WHERE ticket_id = ? AND lifecycle_status = 'active'
         ORDER BY repository_id, id`
          )
          .all(ticketId) as ImplementationTargetRow[];
        return rows.map(mapImplementationTarget);
      },
      archive(targetId, archivedAt) {
        database
          .prepare(
            `UPDATE implementation_targets
         SET lifecycle_status = 'archived', archived_at = ?,
             updated_at = ?
         WHERE id = ?`
          )
          .run(archivedAt, archivedAt, targetId);
      }
    },
    repositoryContextSnapshots: {
      insert(snapshot) {
        database
          .prepare(
            `INSERT INTO repository_context_snapshots (
          id, project_id, repository_id, baseline_commit_sha,
          dirty_state_fingerprint, context_json, is_approvable, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            snapshot.id,
            snapshot.projectId,
            snapshot.repositoryId,
            snapshot.baselineCommitSha,
            snapshot.dirtyStateFingerprint,
            JSON.stringify(snapshot.context),
            snapshot.isApprovable? 1:0,
            snapshot.createdAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, repository_id, baseline_commit_sha,
                dirty_state_fingerprint, context_json, is_approvable,
                created_at
         FROM repository_context_snapshots WHERE id = ?`
          )
          .get(id) as RepositoryContextSnapshotRow|undefined;
        return row? mapRepositoryContextSnapshot(row):null;
      }
    },
    implementationBriefs: {
      insert(brief) {
        database
          .prepare(
            `INSERT INTO implementation_briefs (
          id, project_id, implementation_target_id, ticket_revision_id,
          product_brief_version_id, repository_context_snapshot_id,
          supersedes_implementation_brief_id, slug, brief_json,
          review_status, lifecycle_status, approved_by_actor_id,
          approved_at, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
          )
          .run(
            brief.id,
            brief.projectId,
            brief.implementationTargetId,
            brief.ticketRevisionId,
            brief.productBriefVersionId,
            brief.repositoryContextSnapshotId,
            brief.supersedesImplementationBriefId,
            brief.slug,
            JSON.stringify(brief.brief),
            brief.reviewStatus,
            brief.lifecycleStatus,
            brief.approvedByActorId,
            brief.approvedAt,
            brief.createdAt,
            brief.updatedAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, implementation_target_id,
                ticket_revision_id, product_brief_version_id,
                repository_context_snapshot_id,
                supersedes_implementation_brief_id, slug, brief_json,
                review_status, lifecycle_status, approved_by_actor_id,
                approved_at, created_at, updated_at
         FROM implementation_briefs WHERE id = ?`
          )
          .get(id) as ImplementationBriefRow|undefined;
        return row? mapImplementationBrief(row):null;
      },
      findActiveApprovedByTargetId(implementationTargetId) {
        const row = database
          .prepare(
            `SELECT id, project_id, implementation_target_id,
                ticket_revision_id, product_brief_version_id,
                repository_context_snapshot_id,
                supersedes_implementation_brief_id, slug, brief_json,
                review_status, lifecycle_status, approved_by_actor_id,
                approved_at, created_at, updated_at
         FROM implementation_briefs
         WHERE implementation_target_id = ?
           AND review_status = 'approved'
           AND lifecycle_status = 'active'`
          )
          .get(implementationTargetId) as ImplementationBriefRow|undefined;
        return row? mapImplementationBrief(row):null;
      },
      findLatestArchivedApprovedByTargetId(implementationTargetId) {
        const row = database
          .prepare(
            `SELECT id, project_id, implementation_target_id,
                ticket_revision_id, product_brief_version_id,
                repository_context_snapshot_id,
                supersedes_implementation_brief_id, slug, brief_json,
                review_status, lifecycle_status, approved_by_actor_id,
                approved_at, created_at, updated_at
         FROM implementation_briefs
         WHERE implementation_target_id = ?
           AND review_status = 'approved'
           AND lifecycle_status = 'archived'
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`
          )
          .get(implementationTargetId) as ImplementationBriefRow|undefined;
        return row? mapImplementationBrief(row):null;
      },
      approve(implementationBriefId, actorId, approvedAt) {
        database
          .prepare(
            `UPDATE implementation_briefs
         SET review_status = 'approved', approved_by_actor_id = ?,
             approved_at = ?, updated_at = ?
         WHERE id = ?`
          )
          .run(actorId, approvedAt, approvedAt, implementationBriefId);
      },
      archive(implementationBriefId, archivedAt) {
        database
          .prepare(
            `UPDATE implementation_briefs
         SET lifecycle_status = 'archived', archived_at = ?,
             updated_at = ?
         WHERE id = ?`
          )
          .run(archivedAt, archivedAt, implementationBriefId);
      }
    },
    observedEvidence: {
      insert(evidence, canonicalPayloadJson) {
        database
          .prepare(
            `INSERT INTO observed_evidence (
          id, project_id, repository_id, evidence_type, idempotency_key,
          payload_hash, payload_json, lifecycle_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            evidence.id,
            evidence.projectId,
            evidence.repositoryId,
            evidence.evidenceType,
            evidence.idempotencyKey,
            evidence.payloadHash,
            canonicalPayloadJson,
            evidence.lifecycleStatus,
            evidence.createdAt
          );
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, repository_id, evidence_type,
                idempotency_key, payload_hash, payload_json,
                lifecycle_status, created_at
         FROM observed_evidence WHERE id = ?`
          )
          .get(id) as ObservedEvidenceRow|undefined;
        return row? mapObservedEvidence(row):null;
      },
      findByProjectIdempotencyKey(projectId, idempotencyKey) {
        const row = database
          .prepare(
            `SELECT id, project_id, repository_id, evidence_type,
                idempotency_key, payload_hash, payload_json,
                lifecycle_status, created_at
         FROM observed_evidence
         WHERE project_id = ? AND idempotency_key = ?`
          )
          .get(projectId, idempotencyKey) as ObservedEvidenceRow|undefined;
        return row? mapObservedEvidence(row):null;
      }
    },
    implementationResults: {
      insert(result, observedEvidenceIds, verdicts) {
        database
          .prepare(
            `INSERT INTO implementation_results (
          id, project_id, implementation_brief_id, implementation_target_id,
          ticket_revision_id, supersedes_implementation_result_id,
          result_json, review_status, lifecycle_status,
          stale_at_submission, stale_reasons_json, metadata_json,
          created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`
          )
          .run(
            result.id,
            result.projectId,
            result.implementationBriefId,
            result.implementationTargetId,
            result.ticketRevisionId,
            result.supersedesImplementationResultId,
            JSON.stringify(result.result),
            result.reviewStatus,
            result.lifecycleStatus,
            result.staleAtSubmission? 1:0,
            JSON.stringify(result.staleReasons),
            result.createdAt,
            result.updatedAt,
            result.archivedAt
          );
        const evidenceStatement = database.prepare(
          `INSERT INTO implementation_result_evidence (
            implementation_result_id, observed_evidence_id, created_at
          ) VALUES (?, ?, ?)`
        );
        for (const observedEvidenceId of observedEvidenceIds) {
          evidenceStatement.run(
            result.id,
            observedEvidenceId,
            result.createdAt
          );
        }
        const verdictStatement = database.prepare(
          `INSERT INTO acceptance_criterion_verdicts (
            id, implementation_result_id, acceptance_criterion_id,
            verdict, reason, evidence_ids_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const verdict of verdicts) {
          verdictStatement.run(
            verdict.id,
            verdict.implementationResultId,
            verdict.acceptanceCriterionId,
            verdict.verdict,
            verdict.reason,
            JSON.stringify(verdict.evidenceIds),
            verdict.createdAt
          );
        }
      },
      findById(id) {
        const row = database
          .prepare(
            `SELECT id, project_id, implementation_brief_id,
                implementation_target_id, ticket_revision_id,
                supersedes_implementation_result_id, result_json,
                review_status, lifecycle_status, stale_at_submission,
                stale_reasons_json, created_at, updated_at, archived_at
         FROM implementation_results WHERE id = ?`
          )
          .get(id) as ImplementationResultRow|undefined;
        return row? mapImplementationResult(row):null;
      },
      findActiveApprovedByTargetId(implementationTargetId) {
        const row = database
          .prepare(
            `SELECT id, project_id, implementation_brief_id,
                implementation_target_id, ticket_revision_id,
                supersedes_implementation_result_id, result_json,
                review_status, lifecycle_status, stale_at_submission,
                stale_reasons_json, created_at, updated_at, archived_at
         FROM implementation_results
         WHERE implementation_target_id = ?
           AND review_status = 'approved'
           AND lifecycle_status = 'active'`
          )
          .get(implementationTargetId) as ImplementationResultRow|undefined;
        return row? mapImplementationResult(row):null;
      }
    },
    implementationArtifacts: {
      archiveActiveForTicketRevision(ticketRevisionId, archivedAt) {
        const briefRows = database
          .prepare(
            `SELECT id
         FROM implementation_briefs
         WHERE ticket_revision_id = ?
           AND lifecycle_status = 'active'`
          )
          .all(ticketRevisionId) as Array<{ id: string }>;
        const resultRows = database
          .prepare(
            `SELECT id
         FROM implementation_results
         WHERE ticket_revision_id = ?
           AND lifecycle_status = 'active'`
          )
          .all(ticketRevisionId) as Array<{ id: string }>;
        if (briefRows.length>0) {
          const placeholders = briefRows.map(() => "?").join(", ");
          database
            .prepare(
              `UPDATE implementation_briefs
           SET lifecycle_status = 'archived', archived_at = ?,
               updated_at = ?
           WHERE id IN (${placeholders})`
            )
            .run(archivedAt, archivedAt,...briefRows.map(row => row.id));
        }
        if (resultRows.length>0) {
          const placeholders = resultRows.map(() => "?").join(", ");
          database
            .prepare(
              `UPDATE implementation_results
           SET lifecycle_status = 'archived', archived_at = ?,
               updated_at = ?
           WHERE id IN (${placeholders})`
            )
            .run(archivedAt, archivedAt,...resultRows.map(row => row.id));
        }
        return {
          implementationBriefIds: briefRows.map(row => row.id),
          implementationResultIds: resultRows.map(row => row.id)
        };
      }
    },
  };
}
