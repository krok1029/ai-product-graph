// Implementation workflow 輔助工具。
//
// ImplementationWorkflow 使用的 normalization 與 error helpers。Workflow
// class 負責 handoff freshness 與 approval rules；這個 module 讓 client
// 提供的 brief 與 repository context parsing 保持小而可重用。

import { ApplicationError } from "../domain/errors.js";
import type { ImplementationBriefJson, RepositoryContextJson } from "../domain/models.js";
import type {
  ImplementationBriefInput,
  RepositoryContextInput
} from "./implementation-workflow.js";

export function normalizeRepositoryContext(
  input: RepositoryContextInput
): RepositoryContextJson {
  return {
    repository_name: normalizeRequiredString(
      input.repositoryName,
      "repo_context.repository_name"
    ),
    summary: normalizeRequiredString(input.summary,"repo_context.summary"),
    file_list: normalizeStringArray(input.fileList,"repo_context.file_list"),
    module_notes: normalizeStringArray(
      input.moduleNotes,
      "repo_context.module_notes"
    ),
    has_uncommitted_changes: input.hasUncommittedChanges === true
  };
}

export function normalizeBrief(input: ImplementationBriefInput): ImplementationBriefJson {
  return {
    implementation_plan: normalizeStringArray(
      input.implementationPlan,
      "brief.implementation_plan"
    ),
    suggested_files_to_inspect: normalizeStringArray(
      input.suggestedFilesToInspect,
      "brief.suggested_files_to_inspect"
    ),
    test_strategy: normalizeStringArray(
      input.testStrategy,
      "brief.test_strategy"
    ),
    risks: normalizeStringArray(input.risks,"brief.risks"),
    pr_summary_draft: normalizeRequiredString(
      input.prSummaryDraft,
      "brief.pr_summary_draft"
    )
  };
}

export function normalizeRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" ||!value.trim()) {
    throw validationError(`${field} is required.`);
  }
  return value.trim();
}

export function normalizeOptionalText(value: unknown) {
  return typeof value === "string"&&value.trim()? value.trim():null;
}

export function normalizeStringArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array.`);
  }
  return [...new Set(value.map(item => normalizeRequiredString(item, field)))];
}

export function validationError(message: string) {
  return new ApplicationError("VALIDATION_ERROR", message);
}

export function isRepositoryContextApprovable(
  baselineCommitSha: unknown,
  hasUncommittedChanges: unknown,
  dirtyStateFingerprint: unknown
) {
  const hasBaseline = Boolean(normalizeOptionalText(baselineCommitSha));
  const requiresDirtyFingerprint = hasUncommittedChanges === true;
  return (
    hasBaseline&&
    (!requiresDirtyFingerprint||
      Boolean(normalizeOptionalText(dirtyStateFingerprint)))
  );
}

export function staleHandoff(reason: string, details: Record<string, unknown>) {
  return new ApplicationError("STALE_HANDOFF","Implementation handoff is stale.", {
    reason,
    ...details
  });
}

export function nowSlug(value: string) {
  return value.replace(/[^0-9a-z]/gi,"").toLowerCase();
}
