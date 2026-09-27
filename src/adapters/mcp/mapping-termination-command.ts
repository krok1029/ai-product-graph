import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeExternalWorkItemMapping } from "./external-work-item-tools.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerMappingTerminationCommand(server: McpServer, service: ProductGraphService) {
  server.registerTool("terminate_sync_mapping", {
    title: "Terminate Sync Mapping",
    description: "Explicitly stop future synchronization for a Plane mapping and preserve all historical outcomes.",
    inputSchema: z.object({ mapping_id: z.string().trim().min(1), reason: z.string().trim().min(1) }).strict()
  }, async ({ mapping_id, reason }) => toToolResult(() => {
    const { mapping, termination, decision, auditLogId } = service.terminateSyncMapping({ mappingId: mapping_id, reason });
    return success({ mapping: serializeExternalWorkItemMapping(mapping), termination: {
      id: termination.id, project_id: termination.projectId, mapping_id: termination.mappingId,
      decision_id: termination.decisionId, stopped_sync_intent_ids: termination.stoppedSyncIntentIds
    }, decision: { id: decision.id, project_id: decision.projectId, decision_type: decision.decisionType,
      summary: decision.summary, actor_id: decision.actorId, created_at: decision.createdAt } }, auditLogId);
  }));
}
