// Skills 使用的本機工作入口：組合上下文、開始交付及一次提交證據與候選結果。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { observedEvidenceTypeSchema } from "./schemas.js";
import {
  serializeAcceptanceCriterionVerdict, serializeGraphEdge, serializeGraphNode,
  serializeImplementationBrief, serializeImplementationResult, serializeImplementationTarget,
  serializeProductBriefVersion, serializeRepository, serializeRepositoryContextSnapshot,
  serializeTicket, serializeTicketRevision
} from "./serializers.js";
import { success, toToolResult } from "./tool-envelope.js";

const identity = z.string().trim().min(1);

export function registerLocalWorkflowTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("get_work_context", {
    title: "Get Work Context",
    description: "Read the approved Ticket, product intent, repositories, pending/accepted Results and delivery diagnostics including blockers, missing evidence and next action.",
    inputSchema: z.object({ ticket_id: identity }).strict()
  }, async input => toToolResult(() => {
    const result = service.localDelivery.getContext(input.ticket_id);
    return success({
      ticket: serializeTicket(result.ticket), revision: serializeTicketRevision(result.revision),
      product_brief_version: result.version ? serializeProductBriefVersion(result.version) : null,
      related_nodes: result.relatedNodes.map(serializeGraphNode),
      related_edges: result.relatedEdges.map(serializeGraphEdge),
      delivery: result.delivery,
      targets: result.targets.map(entry => ({
        target: serializeImplementationTarget(entry.target), repository: serializeRepository(entry.repository),
        approved_brief: entry.approvedBrief ? serializeImplementationBrief(entry.approvedBrief) : null,
        pending_result: entry.pendingResult ? serializeImplementationResult(entry.pendingResult) : null,
        accepted_result: entry.acceptedResult ? serializeImplementationResult(entry.acceptedResult) : null
      }))
    });
  }));

  server.registerTool("start_implementation", {
    title: "Start Implementation",
    description: "After user authorization to implement the approved Ticket, atomically approve the saved in-scope execution plan and validate its handoff. Reuse that authorization for routine implementation choices; ask again only for material scope, target or risk changes. An approved brief is only revalidated. Failed freshness never approves a draft. This does not authorize Result acceptance.",
    inputSchema: z.object({
      implementation_brief_id: identity,
      current_repository_state: z.object({
        commit_sha: identity, dirty_state_fingerprint: identity.nullable().optional()
      }).strict()
    }).strict()
  }, async input => toToolResult(() => {
    const result = service.localDelivery.start({
      implementationBriefId: input.implementation_brief_id,
      currentRepositoryState: {
        commitSha: input.current_repository_state.commit_sha,
        dirtyStateFingerprint: input.current_repository_state.dirty_state_fingerprint ?? null
      }
    });
    return success({
      freshness: result.freshness,
      implementation_brief: serializeImplementationBrief(result.implementationBrief),
      implementation_target: serializeImplementationTarget(result.implementationTarget),
      ticket: serializeTicket(result.ticket), ticket_revision: serializeTicketRevision(result.ticketRevision),
      product_brief_version: serializeProductBriefVersion(result.productBriefVersion),
      repository: serializeRepository(result.repository),
      repository_context_snapshot: serializeRepositoryContextSnapshot(result.repositoryContextSnapshot)
    });
  }));

  server.registerTool("submit_work_result", {
    title: "Submit Work Result",
    description: "Atomically save new evidence and a draft Result using local evidence refs. Does not accept the Result or mark the Ticket done. Each successful call creates a new Result; do not blindly retry an unknown outcome.",
    inputSchema: z.object({
      implementation_brief_id: identity,
      supersedes_implementation_result_id: identity.nullable().optional(),
      evidence: z.array(z.object({
        ref: identity, evidence_type: observedEvidenceTypeSchema, idempotency_key: identity,
        payload: z.unknown().refine(value => typeof value === "object" && value !== null && !Array.isArray(value), "payload must be an object.")
      }).strict()).default([]),
      observed_evidence_ids: z.array(identity).default([]),
      summary: identity,
      criterion_verdicts: z.array(z.object({
        acceptance_criterion_id: identity, verdict: z.enum(["satisfied", "unsatisfied"]), reason: identity,
        evidence_refs: z.array(identity).default([]), evidence_ids: z.array(identity).default([])
      }).strict()),
      unfinished_items: z.array(identity).default([])
    }).strict()
  }, async input => toToolResult(() => {
    const result = service.localDelivery.submit({
      implementationBriefId: input.implementation_brief_id,
      supersedesImplementationResultId: input.supersedes_implementation_result_id,
      evidence: input.evidence.map(entry => ({
        ref: entry.ref, evidenceType: entry.evidence_type, idempotencyKey: entry.idempotency_key, payload: entry.payload
      })),
      observedEvidenceIds: input.observed_evidence_ids, summary: input.summary,
      criterionVerdicts: input.criterion_verdicts.map(verdict => ({
        acceptanceCriterionId: verdict.acceptance_criterion_id, verdict: verdict.verdict, reason: verdict.reason,
        evidenceRefs: verdict.evidence_refs, evidenceIds: verdict.evidence_ids
      })), unfinishedItems: input.unfinished_items
    });
    return success({
      implementation_result: serializeImplementationResult(result.implementationResult),
      observed_evidence_ids: result.observedEvidenceIds,
      criterion_verdicts: result.criterionVerdicts.map(serializeAcceptanceCriterionVerdict)
    }, result.auditLogId);
  }));
}
