// 首次匯出固定 approved Ticket projection；provider adapter 日後才轉成 Plane DTO。
import { createHash } from "node:crypto";
import type { TicketRevision } from "../domain/models.js";
import { canonicalizeJson } from "./canonical-json.js";

export type PlaneExportCommand = {
  ticketId: string;
  sourceTicketRevisionId: string;
  externalContainerId: string;
};

export function planeExportPayload(revision: TicketRevision): Record<string, unknown> {
  const specification = revision.specification;
  return JSON.parse(canonicalizeJson({
    schema_version: 1,
    owner: { type: "ticket", id: revision.ticketId },
    source_ticket_revision_id: revision.id,
    specification: {
      title: revision.title,
      user_story: specification.user_story,
      scope: specification.scope,
      acceptance_criteria: specification.acceptance_criteria,
      non_goals: specification.non_goals,
      implementation_notes: specification.implementation_notes
    }
  })) as Record<string, unknown>;
}

export function planeExportKey(projectId: string, actorId: string, key: string): string {
  return `plane-ticket-export:${hashJson({
    project_id: projectId, actor_id: actorId,
    operation: "request_plane_ticket_export", idempotency_key: key
  })}`;
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}
