// 匯出指定 artifact 的 immutable 內容；Markdown 僅供審查，不回寫正式資料。
import { ApplicationError } from "../domain/errors.js";
import type { ApplicationPorts } from "./ports.js";

export type MarkdownExportInput = { entityType: string; entityId: string };

export class MarkdownExport {
  constructor(private readonly ports: ApplicationPorts) {}

  readArtifact(input: MarkdownExportInput) {
    switch (input.entityType) {
      case "product_brief_version":
        return { entityType: "product_brief_version" as const,
          version: requireExportable(this.ports.productBriefVersions.findById(input.entityId)) };
      case "ticket_revision":
        return { entityType: "ticket_revision" as const,
          revision: requireExportable(this.ports.ticketRevisions.findById(input.entityId)) };
      case "implementation_brief":
        return this.readImplementationBrief(input.entityId);
      default:
        throw new ApplicationError("VALIDATION_ERROR", "Unsupported Markdown entity type.");
    }
  }

  private readImplementationBrief(id: string) {
    const brief = requireExportable(this.ports.implementationBriefs.findById(id));
    // 來源依 artifact 固定的 identity 讀取，不套用目前 handoff 的 freshness gate。
    const revision = this.ports.ticketRevisions.findById(brief.ticketRevisionId);
    const version = this.ports.productBriefVersions.findById(brief.productBriefVersionId);
    const snapshot = this.ports.repositoryContextSnapshots.findById(brief.repositoryContextSnapshotId);
    const target = this.ports.implementationTargets.findById(brief.implementationTargetId);
    if (!revision || !version || !snapshot || !target ||
      [revision, version, snapshot, target].some(source => source.projectId !== brief.projectId) ||
      target.ticketId !== revision.ticketId || target.repositoryId !== snapshot.repositoryId ||
      !revision.requiredTargets.some(required => required.repository_id === target.repositoryId)) {
      throw new ApplicationError("STORAGE_ERROR", "Implementation Brief source references are inconsistent.");
    }
    return { entityType: "implementation_brief" as const, brief, revision, version, snapshot, target };
  }
}

function requireExportable<T extends { lifecycleStatus: string }>(artifact: T | null): T {
  if (!artifact) throw new ApplicationError("NOT_FOUND", "Markdown artifact was not found.");
  if (artifact.lifecycleStatus !== "active") {
    throw new ApplicationError("CONFLICT", "Archived artifacts cannot be exported.");
  }
  return artifact;
}
