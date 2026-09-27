// MCP input 轉換器。
//
// 把已通過 validation 的 MCP request payload 轉成 ProductGraphService 預期的
// camelCase application input objects。

import { z } from "zod";

import {
  implementationBriefSchema,
  implementationResultVerdictSchema,
  repositoryContextSchema,
  ticketSpecificationSchema
} from "./schemas.js";

export function toTicketSpecInput(
  input: z.infer<typeof ticketSpecificationSchema>
) {
  return {
    title: input.title,
    tracesToTicketId: input.traces_to_ticket_id ?? null,
    userStory: input.user_story,
    scope: input.scope,
    acceptanceCriteria: input.acceptance_criteria,
    nonGoals: input.non_goals,
    relatedGraphNodeIds: input.related_graph_node_ids,
    dependencies: input.dependencies ?? [],
    implementationTargets: input.implementation_targets.map(target => ({
      repositoryId: target.repository_id,
      scope: target.scope
    })),
    implementationNotes: input.implementation_notes
  };
}

export function toRepositoryContextInput(
  input: z.infer<typeof repositoryContextSchema>
) {
  return {
    repositoryName: input.repository_name,
    summary: input.summary,
    fileList: input.file_list,
    moduleNotes: input.module_notes,
    baselineCommitSha: input.baseline_commit_sha ?? null,
    hasUncommittedChanges: input.has_uncommitted_changes,
    dirtyStateFingerprint: input.dirty_state_fingerprint ?? null
  };
}

export function toImplementationBriefInput(
  input: z.infer<typeof implementationBriefSchema>
) {
  return {
    implementationPlan: input.implementation_plan,
    suggestedFilesToInspect: input.suggested_files_to_inspect,
    testStrategy: input.test_strategy,
    risks: input.risks,
    prSummaryDraft: input.pr_summary_draft
  };
}

export function toImplementationResultVerdictInput(
  input: z.infer<typeof implementationResultVerdictSchema>
) {
  return {
    acceptanceCriterionId: input.acceptance_criterion_id,
    verdict: input.verdict,
    reason: input.reason,
    evidenceIds: input.evidence_ids
  };
}
