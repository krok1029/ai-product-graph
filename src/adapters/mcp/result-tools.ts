// result-tools 的 MCP tool 註冊，將協定輸入轉交 application workflow。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { toImplementationResultVerdictInput } from "./input-mappers.js";
import { implementationResultVerdictSchema, observedEvidenceTypeSchema } from "./schemas.js";
import {
  serializeImplementationResult,
  serializeObservedEvidence,
  serializeAcceptanceCriterionVerdict
} from "./serializers.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerResultTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("accept_implementation_result", {
    title: "Accept Implementation Result",
    description: "Accept a current draft Result with explicit criterion waivers and complete the Ticket when every required target is accepted.",
    inputSchema: z.object({
      idempotency_key: z.string().trim().min(1),
      implementation_result_id: z.string().trim().min(1),
      waivers: z.array(z.object({
        acceptance_criterion_id: z.string().trim().min(1),
        reason: z.string().trim().min(1)
      }).strict()).default([])
    }).strict()
  }, async input => toToolResult(() => {
    const result = service.acceptImplementationResult({
      idempotencyKey: input.idempotency_key, implementationResultId: input.implementation_result_id,
      waivers: input.waivers.map(waiver => ({ acceptanceCriterionId: waiver.acceptance_criterion_id, reason: waiver.reason }))
    });
    return success(result.data, result.auditLogId);
  }));
  server.registerTool(
    "record_observed_evidence",
    {
      title: "Record Observed Evidence",
      description:
        "Persist repository-scoped machine-observed evidence for later Implementation Results.",
      inputSchema: z.object({
        project_id: z.string().min(1),
        repository_id: z.string().min(1),
        evidence_type: observedEvidenceTypeSchema,
        idempotency_key: z.string().min(1),
        // 保留原始欄位交給 closed-schema 驗證，避免 parser 靜默移除 __proto__。
        payload: z.unknown().refine(
          value => typeof value === "object" && value !== null && !Array.isArray(value),
          "payload must be an object."
        )
      }).strict()
    },
    async ({
      project_id,
      repository_id,
      evidence_type,
      idempotency_key,
      payload
    }) =>
      toToolResult(() => {
        const result = service.recordObservedEvidence({
          projectId: project_id,
          repositoryId: repository_id,
          evidenceType: evidence_type,
          idempotencyKey: idempotency_key,
          payload
        });
        return success(
          {
            observed_evidence: serializeObservedEvidence(
              result.observedEvidence
            ),
            created: result.created
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "submit_implementation_result",
    {
      title: "Submit Implementation Result",
      description:
        "Create an immutable draft Implementation Result with verdicts and evidence references.",
      inputSchema: z.object({
        implementation_brief_id: z.string().min(1),
        supersedes_implementation_result_id:
          z.string().min(1).nullable().optional(),
        observed_evidence_ids: z.array(z.string().min(1)),
        summary: z.string().min(1),
        criterion_verdicts: z.array(implementationResultVerdictSchema),
        unfinished_items: z.array(z.string().min(1)).default([])
      }).strict()
    },
    async ({
      implementation_brief_id,
      supersedes_implementation_result_id,
      observed_evidence_ids,
      summary,
      criterion_verdicts,
      unfinished_items
    }) =>
      toToolResult(() => {
        const result = service.submitImplementationResult({
          implementationBriefId: implementation_brief_id,
          supersedesImplementationResultId:
            supersedes_implementation_result_id ?? null,
          observedEvidenceIds: observed_evidence_ids,
          summary,
          criterionVerdicts: criterion_verdicts.map(
            toImplementationResultVerdictInput
          ),
          unfinishedItems: unfinished_items
        });
        return success(
          {
            implementation_result: serializeImplementationResult(
              result.implementationResult
            ),
            observed_evidence_ids: result.observedEvidenceIds,
            criterion_verdicts: result.criterionVerdicts.map(
              serializeAcceptanceCriterionVerdict
            )
          },
          result.auditLogId
        );
      })
  );

}
