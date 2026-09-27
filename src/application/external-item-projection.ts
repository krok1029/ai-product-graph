import type { CreatedExternalProjection } from "./external-work-item-write-ports.js";
import type { PlaneItemObservation } from "./plane-provider-port.js";
import type { SyncIntent } from "../domain/sync-intent.js";
import type { ApplicationPorts } from "./ports.js";

export function createdExternalProjection(intent: SyncIntent, ticketId: string, observation: PlaneItemObservation,
  now: string, idFactory: () => string): CreatedExternalProjection {
  const itemId = idFactory();
  const mappingId = idFactory();
  return {
    externalWorkItem: { id: itemId, externalContainerId: intent.externalContainerId!, provider: "plane",
      externalId: observation.externalId, externalUrl: observation.externalUrl, lifecycleStatus: "active",
      metadata: { created_by_sync_intent_id: intent.id }, createdAt: now, updatedAt: now, archivedAt: null },
    mapping: { id: mappingId, projectId: intent.projectId, internalOwnerType: "ticket", internalOwnerId: ticketId,
      externalContainerId: intent.externalContainerId!, externalWorkItemId: itemId,
      sourceTicketRevisionId: intent.sourceTicketRevisionId, lifecycleStatus: "active", nextSequenceNumber: 1,
      metadata: { created_by_sync_intent_id: intent.id }, createdAt: now, updatedAt: now, archivedAt: null },
    snapshot: { id: idFactory(), projectId: intent.projectId, externalWorkItemId: itemId, mappingId,
      content: observation.content, externalStatus: observation.externalStatus,
      concurrencyToken: observation.concurrencyToken, capturedAt: now }
  };
}

export function insertExternalItemGraphProjection(ports: ApplicationPorts, projection: CreatedExternalProjection,
  title: string, edgeId: string) {
  const { externalWorkItem: item, mapping } = projection;
  ports.graphNodes.insert({ id: item.id, projectId: mapping.projectId, slug: `external_work_item:${item.id}`,
    type: "external_work_item", title, description: null, source: "external_work_item",
    sourceRefType: "external_work_item", sourceRefId: item.id, lifecycleStatus: "active",
    createdInGraphRevisionId: null, lastChangedInGraphRevisionId: null,
    metadata: { external_container_id: item.externalContainerId, mapping_id: mapping.id },
    createdAt: item.createdAt, updatedAt: item.updatedAt });
  ports.graphEdges.insert({ id: edgeId, projectId: mapping.projectId, sourceNodeId: item.id,
    targetNodeId: mapping.internalOwnerId, relationType: "traces_to", confidence: null, lifecycleStatus: "active",
    createdInGraphRevisionId: null, lastChangedInGraphRevisionId: null,
    metadata: { mapping_id: mapping.id }, createdAt: item.createdAt, updatedAt: item.updatedAt });
}
