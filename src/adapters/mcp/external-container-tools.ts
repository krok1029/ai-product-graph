import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import type { ExternalContainer } from "../../domain/external-container.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerExternalContainerTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("register_external_container", {
    title: "Register External Container",
    description: "Register a stable Plane container identity locally without connecting to Plane or enrolling exports.",
    inputSchema: z.object({
      provider: z.literal("plane"),
      workspace_identity: z.string().trim().min(1),
      container_identity: z.string().trim().min(1),
      display_name: z.string().trim().min(1).optional()
    }).strict()
  }, async input => toToolResult(() => {
    const result = service.registerExternalContainer({
      provider: input.provider, workspaceIdentity: input.workspace_identity,
      containerIdentity: input.container_identity, displayName: input.display_name
    });
    return success({ external_container: serializeExternalContainer(result.externalContainer), created: result.created },
      result.auditLogId);
  }));

  server.registerTool("list_external_containers", {
    title: "List External Containers",
    description: "List globally registered container identities in creation order without verifying external connectivity.",
    inputSchema: z.object({ provider: z.literal("plane").optional() }).strict()
  }, async input => toToolResult(() => success({
    external_containers: service.listExternalContainers(input.provider).externalContainers.map(serializeExternalContainer)
  })));
}

function serializeExternalContainer(container: ExternalContainer) {
  return {
    id: container.id, provider: container.provider, workspace_identity: container.workspaceIdentity,
    container_identity: container.containerIdentity, display_name: container.displayName,
    created_at: container.createdAt, updated_at: container.updatedAt
  };
}
