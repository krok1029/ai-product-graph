// Product Brief Markdown projection；只呈現已驗證的 artifact。
import type { ProductBriefVersion } from "../../domain/models.js";
import { list, markdownText, safeFilenamePart } from "./text.js";

export function renderProductBrief(version: ProductBriefVersion) {
  const brief = version.brief;
  const lines = [
    "# Product Brief", "",
    `Version: ${markdownText(version.id)} (${version.versionNumber})`,
    `Project: ${markdownText(version.projectId)}`,
    `Review Status: ${version.reviewStatus}`, "",
    "## Product Goal", markdownText(brief.product_goal), "",
    "## Target Users", ...list(brief.target_users.map(user => `${user.name}: ${user.description}`)), "",
    "## Pain Points", ...list(brief.pain_points.map(pain => `${pain.title}: ${pain.description}`)), "",
    "## Core Workflows"
  ];
  if (brief.core_workflows.length === 0) lines.push("- None");
  for (const workflow of brief.core_workflows) {
    lines.push(`### ${markdownText(workflow.title)}`, ...list(workflow.steps), "");
  }
  for (const [heading, values] of [
    ["MVP Scope", brief.mvp_scope], ["Non-goals", brief.non_goals],
    ["Success Metrics", brief.success_metrics], ["Risks", brief.risks],
    ["Open Questions", brief.open_questions]
  ] as const) {
    lines.push("", `## ${heading}`, ...list(values));
  }
  return {
    markdown: `${lines.join("\n")}\n`,
    suggestedFilename: `product-brief-${safeFilenamePart(version.id)}-v${version.versionNumber}.md`
  };
}

