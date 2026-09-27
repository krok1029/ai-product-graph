// Implementation Brief 與來源快照共同構成交接審查文件，不讀取可變的 current pointers。
import type { ImplementationBrief, ImplementationTarget, ProductBriefVersion,
  RepositoryContextSnapshot, TicketRevision } from "../../domain/models.js";
import { renderProductBrief } from "./product-brief.js";
import { renderTicketRevision } from "./ticket-revision.js";
import { list, markdownText, safeFilenamePart } from "./text.js";

export function renderImplementationBrief(source: {
  brief: ImplementationBrief;
  revision: TicketRevision;
  version: ProductBriefVersion;
  snapshot: RepositoryContextSnapshot;
  target: ImplementationTarget;
}) {
  const { brief, snapshot, target } = source;
  const lines = [
    "# Implementation Brief", "",
    `Implementation Brief: ${markdownText(brief.id)}`,
    `Project: ${markdownText(brief.projectId)}`,
    `Implementation Target: ${markdownText(target.id)}`,
    `Repository: ${markdownText(target.repositoryId)}`,
    `Ticket Revision: ${markdownText(brief.ticketRevisionId)}`,
    `Product Brief Version: ${markdownText(brief.productBriefVersionId)}`,
    `Repository Context Snapshot: ${markdownText(brief.repositoryContextSnapshotId)}`,
    `Supersedes Implementation Brief: ${markdownText(brief.supersedesImplementationBriefId ?? "None")}`,
    `Review Status: ${brief.reviewStatus}`,
    `Approved By: ${markdownText(brief.approvedByActorId ?? "None")}`,
    `Approved At: ${markdownText(brief.approvedAt ?? "None")}`,
    `Created At: ${markdownText(brief.createdAt)}`, ""
  ];
  for (const [heading, values] of [
    ["Implementation Plan", brief.brief.implementation_plan],
    ["Suggested Files to Inspect", brief.brief.suggested_files_to_inspect],
    ["Test Strategy", brief.brief.test_strategy], ["Risks", brief.brief.risks]
  ] as const) lines.push(`## ${heading}`, ...list(values), "");
  lines.push("## PR Summary Draft", markdownText(brief.brief.pr_summary_draft), "",
    "## Repository Context Snapshot",
    `Repository Name: ${markdownText(snapshot.context.repository_name)}`,
    `Baseline Commit SHA: ${markdownText(snapshot.baselineCommitSha ?? "None")}`,
    `Has Uncommitted Changes: ${snapshot.context.has_uncommitted_changes}`,
    `Dirty State Fingerprint: ${markdownText(snapshot.dirtyStateFingerprint ?? "None")}`,
    `Approvable: ${snapshot.isApprovable}`,
    `Captured At: ${markdownText(snapshot.createdAt)}`, "",
    "### Summary", markdownText(snapshot.context.summary), "",
    "### File List", ...list(snapshot.context.file_list), "",
    "### Module Notes", ...list(snapshot.context.module_notes), "",
    "---", "", renderTicketRevision(source.revision).markdown,
    "---", "", renderProductBrief(source.version).markdown);
  return {
    markdown: `${lines.join("\n")}\n`,
    suggestedFilename: `implementation-brief-${safeFilenamePart(brief.id)}.md`
  };
}
