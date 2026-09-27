// 匯出指定 artifact 的 immutable 內容；Markdown 僅供審查，不回寫正式資料。
import { ApplicationError } from "../domain/errors.js";
import type { ProductBriefVersion } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

export type MarkdownExportInput = { entityType: string; entityId: string };

export class MarkdownExport {
  constructor(private readonly ports: ApplicationPorts) {}

  export(input: MarkdownExportInput) {
    if (input.entityType !== "product_brief_version") {
      throw new ApplicationError("VALIDATION_ERROR", "Unsupported Markdown entity type.");
    }
    const version = this.ports.productBriefVersions.findById(input.entityId);
    if (!version) {
      throw new ApplicationError("NOT_FOUND", "Product Brief Version was not found.");
    }
    if (version.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Archived artifacts cannot be exported.");
    }
    return {
      markdown: renderProductBrief(version),
      suggestedFilename: `product-brief-${safeFilenamePart(version.id)}-v${version.versionNumber}.md`
    };
  }
}

function renderProductBrief(version: ProductBriefVersion) {
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
  return `${lines.join("\n")}\n`;
}

export function safeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "artifact";
}

export function markdownText(value: string) {
  // 來源文字可含 Markdown 或 HTML；當作文字呈現，避免改變文件結構。
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1")
    .replace(/\r?\n/g, "<br>");
}

export function list(values: readonly string[]) {
  return values.length ? values.map(value => `- ${markdownText(value)}`) : ["- None"];
}
