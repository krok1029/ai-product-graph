// Project 的正式內容讀取；草稿不會取代目前已核准的版本。
import { ApplicationError } from "../domain/errors.js";
import type { ApplicationPorts } from "./ports.js";

export class ProjectReads {
  constructor(private readonly ports: ApplicationPorts) {}

  getBrief(projectId: string) {
    this.requireActiveProject(projectId);
    const brief = this.ports.productBriefs.findByProjectId(projectId);
    if (!brief || brief.lifecycleStatus !== "active" || !brief.currentApprovedVersionId) {
      return { productBrief: null, version: null };
    }
    const version = this.ports.productBriefVersions.findById(brief.currentApprovedVersionId);
    if (!version || version.projectId !== projectId || version.productBriefId !== brief.id ||
        version.reviewStatus !== "approved" || version.lifecycleStatus !== "active") {
      throw new ApplicationError("STORAGE_ERROR", "Approved Product Brief pointer is inconsistent.");
    }
    return { productBrief: brief, version };
  }

  getTickets(projectId: string) {
    this.requireActiveProject(projectId);
    const tickets = this.ports.tickets.listByProjectId(projectId)
      .filter(ticket => ticket.lifecycleStatus === "active" && ticket.currentApprovedRevisionId);
    return { tickets };
  }

  private requireActiveProject(projectId: string) {
    const project = this.ports.projects.findById(projectId);
    if (!project) {
      throw new ApplicationError("NOT_FOUND", "Active Project was not found.", { projectId });
    }
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Project is archived.", { projectId });
    }
    return project;
  }
}
