import type { ApplicationPorts } from "../../application/ports.js";
import type { Decision, OperationReceipt, ResultAcceptance } from "../../domain/result-acceptance.js";
import type { SqliteDatabase } from "./database.js";

const acceptanceColumns = `id, project_id AS projectId,
  implementation_result_id AS implementationResultId, actor_id AS actorId,
  accepted_at AS acceptedAt`;

export function createResultAcceptanceRepositories(database: SqliteDatabase): Pick<
  ApplicationPorts, "resultAcceptances" | "decisions" | "operationReceipts"
> {
  return {
    resultAcceptances: {
      insert(value) {
        database.prepare(`INSERT INTO result_acceptances
          (id, project_id, implementation_result_id, actor_id, accepted_at)
          VALUES (?, ?, ?, ?, ?)`).run(value.id, value.projectId,
          value.implementationResultId, value.actorId, value.acceptedAt);
      },
      findById(id) {
        return database.prepare(`SELECT ${acceptanceColumns} FROM result_acceptances WHERE id = ?`)
          .get(id) as ResultAcceptance | undefined ?? null;
      },
      findByResultId(resultId) {
        return database.prepare(`SELECT ${acceptanceColumns} FROM result_acceptances WHERE implementation_result_id = ?`)
          .get(resultId) as ResultAcceptance | undefined ?? null;
      },
      insertOutcome(value) {
        database.prepare(`INSERT INTO result_acceptance_criterion_outcomes
          (id, result_acceptance_id, acceptance_criterion_id, submitted_verdict_id,
           outcome, waiver_decision_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(value.id, value.resultAcceptanceId, value.acceptanceCriterionId,
            value.submittedVerdictId, value.outcome, value.waiverDecisionId, value.createdAt);
      }
    },
    decisions: {
      insert(value) {
        database.prepare(`INSERT INTO decisions
          (id, project_id, decision_type, summary, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run(value.id, value.projectId,
          value.decisionType, value.summary, value.actorId, value.createdAt);
      },
      findById(id) {
        return database.prepare(`SELECT id, project_id AS projectId, decision_type AS decisionType,
          summary, actor_id AS actorId, created_at AS createdAt FROM decisions WHERE id = ?`)
          .get(id) as Decision | undefined ?? null;
      }
    },
    operationReceipts: {
      insert(value) {
        database.prepare(`INSERT INTO operation_receipts
          (id, project_id, local_actor_id, operation_name, idempotency_key,
           normalized_command_hash, normalized_command_json, response_json,
           response_audit_log_id, result_acceptance_id, result_revocation_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(value.id, value.projectId, value.localActorId, value.operationName,
            value.idempotencyKey, value.normalizedCommandHash, value.normalizedCommandJson,
            value.responseJson, value.responseAuditLogId, value.resultAcceptanceId,
            value.resultRevocationId, value.createdAt);
      },
      find(projectId, actorId, operation, key) {
        return database.prepare(`SELECT id, project_id AS projectId, local_actor_id AS localActorId,
          operation_name AS operationName, idempotency_key AS idempotencyKey,
          normalized_command_hash AS normalizedCommandHash, normalized_command_json AS normalizedCommandJson,
          response_json AS responseJson, response_audit_log_id AS responseAuditLogId,
          result_acceptance_id AS resultAcceptanceId, result_revocation_id AS resultRevocationId,
          created_at AS createdAt FROM operation_receipts
          WHERE project_id = ? AND local_actor_id = ? AND operation_name = ? AND idempotency_key = ?`)
          .get(projectId, actorId, operation, key) as OperationReceipt | undefined ?? null;
      }
    }
  };
}
