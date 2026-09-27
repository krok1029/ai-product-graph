import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import type { ExternalWorkItem, ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../../domain/external-work-item.js";
import { success, toToolResult } from "./tool-envelope.js";

export function serializeExternalWorkItem(item: ExternalWorkItem) {
  return { id: item.id, external_container_id: item.externalContainerId, provider: item.provider,
    external_id: item.externalId, external_url: item.externalUrl, lifecycle_status: item.lifecycleStatus,
    metadata: item.metadata, created_at: item.createdAt, updated_at: item.updatedAt, archived_at: item.archivedAt };
}

export function serializeExternalWorkItemMapping(mapping: ExternalWorkItemMapping) {
  return { id: mapping.id, project_id: mapping.projectId, internal_owner_type: mapping.internalOwnerType,
    internal_owner_id: mapping.internalOwnerId, external_container_id: mapping.externalContainerId,
    external_work_item_id: mapping.externalWorkItemId, source_ticket_revision_id: mapping.sourceTicketRevisionId,
    lifecycle_status: mapping.lifecycleStatus, next_sequence_number: mapping.nextSequenceNumber,
    metadata: mapping.metadata, created_at: mapping.createdAt, updated_at: mapping.updatedAt,
    archived_at: mapping.archivedAt };
}

export function serializeExternalWorkItemSnapshot(snapshot: ExternalWorkItemSnapshot) {
  return { id: snapshot.id, project_id: snapshot.projectId, external_work_item_id: snapshot.externalWorkItemId,
    mapping_id: snapshot.mappingId, content: snapshot.content, external_status: snapshot.externalStatus,
    concurrency_token: snapshot.concurrencyToken, captured_at: snapshot.capturedAt };
}

export function registerExternalWorkItemTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("list_ticket_external_work_items", {
    title: "List Ticket External Work Items",
    description: "Read verified Plane Ticket mappings and immutable snapshots, including archived history.",
    inputSchema: z.object({ ticket_id: z.string().trim().min(1) }).strict()
  }, async ({ ticket_id }) => toToolResult(() => success({
    items: service.listTicketExternalWorkItems(ticket_id).items.map(({ mapping, externalWorkItem, snapshots }) => ({
      mapping: serializeExternalWorkItemMapping(mapping), external_work_item: serializeExternalWorkItem(externalWorkItem),
      snapshots: snapshots.map(serializeExternalWorkItemSnapshot)
    }))
  })));

  server.registerTool("get_external_work_item", {
    title: "Get External Work Item",
    description: "Read a Plane item and its verified mapping and snapshot history without calling providers.",
    inputSchema: z.object({ external_work_item_id: z.string().trim().min(1) }).strict()
  }, async ({ external_work_item_id }) => toToolResult(() => {
    const result = service.getExternalWorkItem(external_work_item_id);
    return success({ external_work_item: serializeExternalWorkItem(result.externalWorkItem),
      mappings: result.mappings.map(serializeExternalWorkItemMapping),
      snapshots: result.snapshots.map(serializeExternalWorkItemSnapshot) });
  }));
}
