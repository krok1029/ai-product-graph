import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import type { SyncIntent, SyncIntentDetails } from "../../domain/sync-intent.js";
import { success, toToolResult } from "./tool-envelope.js";

export function serializeSyncIntent(intent: SyncIntent) {
  return {
    id: intent.id, project_id: intent.projectId, mapping_id: intent.mappingId,
    external_container_id: intent.externalContainerId, sequence_number: intent.sequenceNumber,
    operation: intent.operation, source_event_type: intent.sourceEventType, source_event_id: intent.sourceEventId,
    source_ticket_revision_id: intent.sourceTicketRevisionId, payload_hash: intent.payloadHash,
    payload: intent.payload, idempotency_key: intent.idempotencyKey,
    supersedes_sync_intent_id: intent.supersedesSyncIntentId, lifecycle_status: intent.lifecycleStatus,
    created_at: intent.createdAt
  };
}

export function serializeSyncIntentDetails({ syncIntent, attempts, requestState }: SyncIntentDetails) {
  return {
    sync_intent: serializeSyncIntent(syncIntent),
    attempts: attempts.map(attempt => ({
      id: attempt.id, sync_intent_id: attempt.syncIntentId, external_work_item_id: attempt.externalWorkItemId,
      operation: attempt.operation, idempotency_key: attempt.idempotencyKey, started_at: attempt.startedAt,
      completed_at: attempt.completedAt, result_status: attempt.resultStatus,
      response: attempt.response, error: attempt.error
    })),
    request_state: requestState
  };
}

export function registerSyncIntentTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("get_sync_intent", {
    title: "Get Sync Intent",
    description: "Read a durable Sync Intent and chronological attempt history without calling providers.",
    inputSchema: { sync_intent_id: z.string().min(1) }
  }, async ({ sync_intent_id }) => toToolResult(() =>
    success(serializeSyncIntentDetails(service.getSyncIntent(sync_intent_id)))
  ));

  server.registerTool("list_ticket_export_requests", {
    title: "List Ticket Export Requests",
    description: "Read a Ticket's pinned Plane first-export requests, including archived history.",
    inputSchema: { ticket_id: z.string().min(1) }
  }, async ({ ticket_id }) => toToolResult(() => success({
    requests: service.listTicketExportRequests(ticket_id).requests.map(serializeSyncIntentDetails)
  })));
}
