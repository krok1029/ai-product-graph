// 匯出指定 artifact 的 immutable 內容；Markdown 僅供審查，不回寫正式資料。
import { ApplicationError } from "../domain/errors.js";
import type { ApplicationPorts } from "./ports.js";

export type MarkdownExportInput = { entityType: string; entityId: string };

export class MarkdownExport {
  constructor(private readonly ports: ApplicationPorts) {}

  readArtifact(input: MarkdownExportInput) {
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
    return { entityType: "product_brief_version" as const, version };
  }
}

