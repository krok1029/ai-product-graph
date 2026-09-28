// MCP request schemas。
//
// 公開 MCP tool interface 使用的 Zod schemas。這裡刻意維持
// docs/12-mcp-tool-spec.md 記載的 snake_case wire shape。

import { z } from "zod";

export const graphNodeTypeSchema = z.enum([
  "idea",
  "product_brief",
  "milestone",
  "spec",
  "product_goal",
  "persona",
  "pain_point",
  "workflow",
  "feature_area",
  "epic",
  "ticket",
  "acceptance_criterion",
  "decision",
  "repository",
  "code_file",
  "pull_request",
  "test_case",
  "release",
  "feedback",
  "implementation_target",
  "external_work_item"
]);

export const productBriefJsonSchema = z
  .object({
    product_goal: z.string().min(1),
    target_users: z.array(
      z
        .object({
          name: z.string(),
          description: z.string()
        })
        .strict()
    ),
    pain_points: z.array(
      z
        .object({
          title: z.string(),
          description: z.string()
        })
        .strict()
    ),
    core_workflows: z.array(
      z
        .object({
          title: z.string(),
          steps: z.array(z.string())
        })
        .strict()
    ),
    mvp_scope: z.array(z.string()),
    non_goals: z.array(z.string()),
    success_metrics: z.array(z.string()),
    risks: z.array(z.string()),
    open_questions: z.array(z.string())
  })
  .strict();

export const ticketSpecificationSchema = z
  .object({
    title: z.string().min(1),
    source_spec_id: z.string().min(1).optional(),
    traces_to_ticket_id: z.string().min(1).nullable().optional(),
    user_story: z.string().min(1),
    scope: z.array(z.string()),
    acceptance_criteria: z.array(z.string().min(1)),
    non_goals: z.array(z.string()),
    related_graph_node_ids: z.array(z.string().min(1)),
    dependencies: z.array(z.string().min(1)).optional(),
    implementation_targets: z.array(
      z
        .object({
          repository_id: z.string().min(1),
          scope: z.array(z.string())
        })
        .strict()
    ),
    implementation_notes: z.array(z.string()).default([])
  })
  .strict();

export const repositoryContextSchema = z
  .object({
    repository_name: z.string().min(1),
    summary: z.string().min(1),
    file_list: z.array(z.string().min(1)),
    module_notes: z.array(z.string().min(1)),
    baseline_commit_sha: z.string().min(1).nullable().optional(),
    has_uncommitted_changes: z.boolean().default(false),
    dirty_state_fingerprint: z.string().min(1).nullable().optional()
  })
  .strict();

export const implementationBriefSchema = z
  .object({
    implementation_plan: z.array(z.string().min(1)),
    suggested_files_to_inspect: z.array(z.string().min(1)),
    test_strategy: z.array(z.string().min(1)),
    risks: z.array(z.string().min(1)),
    pr_summary_draft: z.string().min(1)
  })
  .strict();

export const observedEvidenceTypeSchema = z.enum([
  "commit",
  "pull_request",
  "test_execution",
  "artifact"
]);

export const implementationResultVerdictSchema = z
  .object({
    acceptance_criterion_id: z.string().min(1),
    verdict: z.enum(["satisfied","unsatisfied"]),
    reason: z.string().min(1),
    evidence_ids: z.array(z.string().min(1))
  })
  .strict();
