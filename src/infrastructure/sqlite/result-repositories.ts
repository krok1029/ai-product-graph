import type { ApplicationPorts } from "../../application/ports.js";
import type { AcceptanceCriterionVerdict } from "../../domain/models.js";
import type { SqliteDatabase } from "./database.js";
import { mapImplementationResult, type ImplementationResultRow } from "./row-mappers.js";

export function createResultRepositories(database: SqliteDatabase): Pick<ApplicationPorts, "implementationResults"> {
  return {
    implementationResults: {
      findLatestActiveDraftByTargetId(targetId) {
        const row = database.prepare(`SELECT id, project_id, implementation_brief_id,
          implementation_target_id, ticket_revision_id, supersedes_implementation_result_id,
          result_json, review_status, lifecycle_status, stale_at_submission,
          stale_reasons_json, created_at, updated_at, archived_at
          FROM implementation_results WHERE implementation_target_id = ?
          AND review_status = 'draft' AND lifecycle_status = 'active'
          ORDER BY created_at DESC, id DESC LIMIT 1`).get(targetId) as ImplementationResultRow | undefined;
        return row ? mapImplementationResult(row) : null;
      },
      listVerdicts(resultId) {
        const rows = database.prepare(`SELECT id, implementation_result_id AS implementationResultId,
          acceptance_criterion_id AS acceptanceCriterionId, verdict, reason,
          evidence_ids_json AS evidenceIdsJson, created_at AS createdAt
          FROM acceptance_criterion_verdicts WHERE implementation_result_id = ?`).all(resultId) as
          Array<Omit<AcceptanceCriterionVerdict, "evidenceIds"> & { evidenceIdsJson: string }>;
        return rows.map(({ evidenceIdsJson, ...row }) => ({ ...row, evidenceIds: JSON.parse(evidenceIdsJson) as string[] }));
      },
      listEvidenceIds(resultId) {
        return (database.prepare("SELECT observed_evidence_id AS id FROM implementation_result_evidence WHERE implementation_result_id = ?")
          .all(resultId) as Array<{ id: string }>).map(row => row.id);
      },
      approve(resultId, approvedAt) {
        database.prepare("UPDATE implementation_results SET review_status = 'approved', updated_at = ? WHERE id = ?")
          .run(approvedAt, resultId);
      },
      archive(resultId, archivedAt) {
        database.prepare("UPDATE implementation_results SET lifecycle_status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
          .run(archivedAt, archivedAt, resultId);
      },
      archiveOtherDrafts(targetId, exceptResultId, archivedAt) {
        const rows = database.prepare(`SELECT id FROM implementation_results WHERE implementation_target_id = ?
          AND id != ? AND review_status = 'draft' AND lifecycle_status = 'active' ORDER BY id`)
          .all(targetId, exceptResultId) as Array<{ id: string }>;
        for (const row of rows) {
          database.prepare("UPDATE implementation_results SET lifecycle_status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
            .run(archivedAt, archivedAt, row.id);
        }
        return rows.map(row => row.id);
      },
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
  };
}
