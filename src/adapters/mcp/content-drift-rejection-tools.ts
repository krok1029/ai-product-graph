// Full profile 的明確拒絕指令；actor、時間與所有 provenance 由 server 決定。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeContentDriftResolution } from "./content-drift-resolution-serialization.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerContentDriftRejectionTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("reject_content_drift", {
    title: "Reject Content Drift",
    description: "Record an immutable decision not to adopt saved external content changes. Does not approve implementation, overwrite external content, or synchronize anything.",
    inputSchema: z.object({ content_drift_id: z.string().trim().min(1), reason: z.string().trim().min(1) }).strict()
  }, async ({ content_drift_id, reason }) => toToolResult(() => {
    const result = service.rejectContentDrift({ contentDriftId: content_drift_id, reason });
    return success(serializeContentDriftResolution(result), result.auditLogId);
  }));
}
