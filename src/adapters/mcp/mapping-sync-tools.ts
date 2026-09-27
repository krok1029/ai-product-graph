import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeExternalWorkItemMapping } from "./external-work-item-tools.js";
import { serializeSyncIntentDetails } from "./sync-intent-tools.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerMappingSyncTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("list_mapping_sync_intents", {
    title: "List Mapping Sync Intents",
    description: "Read the original create proof and all ordered mapping intents and attempts, including archived history.",
    inputSchema: z.object({ mapping_id: z.string().trim().min(1) }).strict()
  }, async ({ mapping_id }) => toToolResult(() => {
    const history = service.listMappingSyncIntents(mapping_id);
    return success({ mapping: serializeExternalWorkItemMapping(history.mapping),
      create_request: history.createRequest ? serializeSyncIntentDetails(history.createRequest) : null,
      intents: history.intents.map(serializeSyncIntentDetails) });
  }));
}
