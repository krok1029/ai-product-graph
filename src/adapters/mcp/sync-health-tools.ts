import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import type { MappingSyncHealth } from "../../domain/sync-health.js";
import { success, toToolResult } from "./tool-envelope.js";

export function serializeMappingSyncHealth(result: MappingSyncHealth) {
  return { sync_health: result.syncHealth, included: result.included, required_intent_ids: result.requiredIntentIds,
    ignored_content_intent_ids: result.ignoredContentIntentIds,
    reasons: result.reasons.map(reason => ({ code: reason.code, ...(reason.intentId ? { intent_id: reason.intentId } : {}) })) };
}

export function registerSyncHealthTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("get_mapping_sync_health", {
    title: "Get Mapping Sync Health",
    description: "Explain durable synchronization obligations for a mapping without provider calls or mutations. Current does not verify external drift.",
    inputSchema: z.object({ mapping_id: z.string().trim().min(1) }).strict()
  }, async ({ mapping_id }) => toToolResult(() => success(serializeMappingSyncHealth(service.getMappingSyncHealth(mapping_id)))));
}
