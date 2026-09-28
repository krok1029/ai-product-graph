import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ResolvedPlaneObservationHistory } from "../../application/plane-observation-read-ports.js";
import { serializeContentDriftResolutionDetails } from "./content-drift-resolution-serialization.js";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeExternalWorkItemMapping, serializeExternalWorkItemSnapshot } from "./external-work-item-tools.js";
import { resourceJson } from "./project-resources.js";
import { success, toToolResult } from "./tool-envelope.js";

export function serializePlaneObservationHistory(history: ResolvedPlaneObservationHistory) {
  return {
    mapping: serializeExternalWorkItemMapping(history.mapping),
    observations: history.observations.map(({ snapshot, provenance }) => ({
      snapshot: serializeExternalWorkItemSnapshot(snapshot), provenance: {
        snapshot_id: provenance.snapshotId, project_id: provenance.projectId, mapping_id: provenance.mappingId,
        external_work_item_id: provenance.externalWorkItemId, ticket_id: provenance.ticketId,
        source_ticket_revision_id: provenance.sourceTicketRevisionId, actor_id: provenance.actorId, audit_log_id: provenance.auditLogId
      }
    })),
    drifts: history.drifts.map(drift => ({ id: drift.id, project_id: drift.projectId, mapping_id: drift.mappingId,
      snapshot_id: drift.externalWorkItemSnapshotId, diff: drift.diff, detected_at: drift.detectedAt,
      resolution_decision_id: drift.resolutionDecisionId, resolution: serializeContentDriftResolutionDetails(drift.resolution) }))
  };
}

export function registerPlaneObservationReadTools(server: McpServer, service: ProductGraphService) {
  const description = "Read immutable Plane observation and Content Drift history, including archived mappings, without calling providers or changing state.";
  server.registerTool("get_mapping_content_drift_history", {
    title: "Get Mapping Content Drift History", description,
    inputSchema: z.object({ mapping_id: z.string().trim().min(1) }).strict()
  }, async ({ mapping_id }) => toToolResult(() => success(serializePlaneObservationHistory(service.getMappingContentDriftHistory(mapping_id)))));
  server.registerResource("mapping-content-drifts",
    new ResourceTemplate("product-graph://external-work-item-mappings/{mappingId}/content-drifts", { list: undefined }),
    { title: "Mapping Content Drift history", description, mimeType: "application/json" }, async (uri, variables) =>
      resourceJson(uri, () => serializePlaneObservationHistory(service.getMappingContentDriftHistory(String(variables.mappingId)))));
}
