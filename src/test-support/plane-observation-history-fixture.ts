import { mappingTerminationReadFixture } from "./mapping-termination-read-fixture.js";
import { createPlaneObservationWriteRepository } from "../infrastructure/sqlite/plane-observation-write-repository.js";
import type { ContentDrift, ManagedFieldChange, PlaneObservation } from "../domain/plane-observation.js";
import type { ExternalWorkItemSnapshot } from "../domain/external-work-item.js";

export async function planeObservationHistoryFixture() {
  const f = mappingTerminationReadFixture();
  const { mapping, create } = await f.exportMapping();
  const writes = createPlaneObservationWriteRepository(f.database);
  let index = 0;
  return { ...f, mapping, create, capture, replaceRevision, allRows };

  function capture(options: { id?: string; revisionId?: string; capturedAt?: string; detectedAt?: string;
    changes?: ManagedFieldChange[]; content?: Record<string, unknown> } = {}) {
    const id = options.id ?? `observation-${++index}`;
    const capturedAt = options.capturedAt ?? "2026-09-27T10:00:00.000Z";
    const detectedAt = options.detectedAt ?? "2026-09-27T10:00:01.000Z";
    const observation: PlaneObservation = { snapshotId: id, projectId: f.project.id, mappingId: mapping.id,
      externalWorkItemId: mapping.externalWorkItemId, ticketId: f.ticket.id,
      sourceTicketRevisionId: options.revisionId ?? f.revision.id, actorId: "history-observer", auditLogId: `${id}-audit` };
    const snapshot: ExternalWorkItemSnapshot = { id, projectId: f.project.id, mappingId: mapping.id,
      externalWorkItemId: mapping.externalWorkItemId, content: options.content ?? {
        name: "External <title>", description_html: "<p>外部原文</p>", external_source: "ai-product-graph",
        external_id: create.idempotencyKey, labels: ["保持原樣"], future: JSON.parse('{"__proto__":{"value":1}}') as unknown
      }, externalStatus: "opaque-state", concurrencyToken: "provider-token", capturedAt };
    const changes = options.changes ?? [{ field: "name", expected: "Deliver feature",
      observed: { present: true, value: "External <title>" } }];
    const drift: ContentDrift | null = changes.length ? { id: `${id}-drift`, projectId: f.project.id, mappingId: mapping.id,
      externalWorkItemSnapshotId: id, diff: { schema_version: 1, source_ticket_revision_id: observation.sourceTicketRevisionId, changes },
      detectedAt, resolutionDecisionId: null } : null;
    // Reads 的 fixture 經同一正式 write port 保存合法 immutable history，無外部 HTTP。
    f.ports.transactions.run(() => {
      f.ports.localActors.ensure({ id: observation.actorId, displayName: "Observer", createdAt: detectedAt, updatedAt: detectedAt });
      f.ports.auditLog.append({ id: observation.auditLogId, projectId: f.project.id, actorType: "mcp_client",
        actorId: observation.actorId, action: "plane_mapping.observed", entityType: "plane_observation", entityId: id,
        beforeSummary: null, afterSummary: null, metadata: {}, createdAt: detectedAt });
      writes.insertCapture({ snapshot, observation, drift });
    });
    return { snapshot, provenance: observation, drift };
  }

  function replaceRevision() {
    const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
      sourceGraphRevisionId: f.graph.graphRevision.id,
      specification: { title: "New title", userStory: "New story", scope: ["Feature"], acceptanceCriteria: ["New criterion"],
        nonGoals: [], relatedGraphNodeIds: [f.goal], implementationTargets: f.revision.requiredTargets.map(value => ({
          repositoryId: value.repository_id, scope: value.scope })), implementationNotes: [] } });
    return f.service.approveTicketRevision(draft.revision.id).revision;
  }

  function allRows() {
    const tables = f.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    return Object.fromEntries(tables.map(({ name }) => [name, f.database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]));
  }
}
