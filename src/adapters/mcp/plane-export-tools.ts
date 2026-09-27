import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeSyncIntent } from "./sync-intent-tools.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerPlaneExportTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("request_plane_ticket_export", {
    title: "Request Plane Ticket Export",
    description: "Persist an explicit first-export request. This queues local work; it does not call Plane.",
    inputSchema: z.object({
      ticket_id: z.string().min(1),
      source_ticket_revision_id: z.string().min(1),
      external_container_id: z.string().min(1),
      idempotency_key: z.string().min(1)
    }).strict()
  }, async input => toToolResult(() => {
    const result = service.requestPlaneTicketExport({ ticketId: input.ticket_id,
      sourceTicketRevisionId: input.source_ticket_revision_id,
      externalContainerId: input.external_container_id, idempotencyKey: input.idempotency_key });
    return success({ sync_intent: serializeSyncIntent(result.syncIntent) }, result.auditLogId);
  }));
}
