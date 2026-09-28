import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeContentDriftResolution } from "./content-drift-resolution-serialization.js";
import { resourceJson } from "./project-resources.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerContentDriftResolutionReadTools(server: McpServer, service: ProductGraphService) {
  const description = "Read a Content Drift's saved evidence and resolution, including the linked draft's current review/lifecycle state. Resolution does not imply Ticket approval, implementation Acceptance or outbound synchronization.";
  server.registerTool("get_content_drift_resolution", {
    title: "Get Content Drift Resolution", description,
    inputSchema: z.object({ content_drift_id: z.string().trim().min(1) }).strict()
  }, async ({ content_drift_id }) => toToolResult(() =>
    success(serializeContentDriftResolution(service.getContentDriftResolution(content_drift_id)))));
  server.registerResource("content-drift-resolution",
    new ResourceTemplate("product-graph://content-drifts/{driftId}/resolution", { list: undefined }),
    { title: "Content Drift Resolution", description, mimeType: "application/json" }, async (uri, variables) =>
      resourceJson(uri, () => serializeContentDriftResolution(service.getContentDriftResolution(String(variables.driftId)))));
}
