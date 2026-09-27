import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MappingTerminationHistory } from "../../application/mapping-termination-reads.js";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { resourceJson } from "./project-resources.js";
import { serializeSyncIntentDetails } from "./sync-intent-tools.js";
import { success, toToolResult } from "./tool-envelope.js";

export function serializeMappingTerminationHistory(history: MappingTerminationHistory) {
  if (!history.termination) return { mapping_id: history.mappingId, termination: null };
  const { termination, decision, stoppedIntents } = history.termination;
  return { mapping_id: history.mappingId, termination: {
    record: { id: termination.id, project_id: termination.projectId, mapping_id: termination.mappingId,
      decision_id: termination.decisionId, stopped_sync_intent_ids: termination.stoppedSyncIntentIds },
    decision: { id: decision.id, project_id: decision.projectId, decision_type: decision.decisionType,
      summary: decision.summary, actor_id: decision.actorId, created_at: decision.createdAt },
    stopped_intents: stoppedIntents.map(serializeSyncIntentDetails)
  } };
}

export function registerMappingTerminationReadTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("get_mapping_termination", {
    title: "Get Mapping Termination",
    description: "Explain the explicit decision to stop synchronization and preserve each stopped obligation's actual outcomes.",
    inputSchema: z.object({ mapping_id: z.string().trim().min(1) }).strict()
  }, async ({ mapping_id }) => toToolResult(() => success(serializeMappingTerminationHistory(service.getMappingTermination(mapping_id)))));
  server.registerResource("mapping-termination",
    new ResourceTemplate("product-graph://external-work-item-mappings/{mappingId}/termination", { list: undefined }),
    { title: "Mapping termination", mimeType: "application/json" }, async (uri, variables) =>
      resourceJson(uri, () => serializeMappingTerminationHistory(service.getMappingTermination(String(variables.mappingId)))));
}
