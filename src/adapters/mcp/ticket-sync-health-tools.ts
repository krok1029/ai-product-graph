import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import type { TicketSyncHealth } from "../../application/ticket-sync-health-reads.js";
import { serializeMappingSyncHealth } from "./sync-health-tools.js";
import { resourceJson } from "./project-resources.js";
import { success, toToolResult } from "./tool-envelope.js";

export function serializeTicketSyncHealth(result: TicketSyncHealth) {
  return {
    ticket_id: result.ticketId, sync_health: result.syncHealth,
    active_mapping_count: result.activeMappingCount, outstanding_export_count: result.outstandingExportCount,
    mappings: result.mappings.map(mapping => ({ mapping_id: mapping.mappingId, external_work_item_id: mapping.externalWorkItemId,
      ...serializeMappingSyncHealth(mapping) })),
    outstanding_exports: result.outstandingExports.map(item => ({ sync_intent_id: item.intentId,
      sync_health: item.syncHealth, request_state: item.requestState })),
    reasons: result.reasons.map(reason => ({ code: reason.code,
      ...(reason.mappingId ? { mapping_id: reason.mappingId } : {}), ...(reason.intentId ? { intent_id: reason.intentId } : {}) }))
  };
}

export function registerTicketSyncHealthTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("get_ticket_sync_health", {
    title: "Get Ticket Sync Health",
    description: "Derive current synchronization obligations across active mappings and outstanding manual exports.",
    inputSchema: z.object({ ticket_id: z.string().trim().min(1) }).strict()
  }, async ({ ticket_id }) => toToolResult(() => success(serializeTicketSyncHealth(service.getTicketSyncHealth(ticket_id)))));
  server.registerResource("ticket-sync-health", new ResourceTemplate("product-graph://tickets/{ticketId}/sync-health", { list: undefined }),
    { title: "Ticket sync health", mimeType: "application/json" }, async (uri, variables) =>
      resourceJson(uri, () => serializeTicketSyncHealth(service.getTicketSyncHealth(String(variables.ticketId)))));
}
