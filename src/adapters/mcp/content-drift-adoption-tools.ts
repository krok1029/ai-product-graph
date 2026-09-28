// Full profile 的候選採用入口；不解析 HTML、不代替上游規劃或實作驗收。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeContentDriftResolution } from "./content-drift-resolution-serialization.js";
import { toTicketSpecInput } from "./input-mappers.js";
import { ticketSpecificationSchema } from "./schemas.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerContentDriftAdoptionTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("adopt_content_drift", {
    title: "Adopt Content Drift",
    description: "Create a normal draft for the mapped Ticket from a user-selected structured specification and saved name/description changes. Assess scope first: product/capability changes require upstream planning, and new capabilities may require a separate Ticket. Does not validate prose consistency, edit planning, approve or accept work, rewrite markers, or synchronize externally.",
    inputSchema: z.object({ content_drift_id: z.string().trim().min(1), reason: z.string().trim().min(1),
      base_approved_revision_id: z.string().trim().min(1), source_graph_revision_id: z.string().trim().min(1),
      specification: ticketSpecificationSchema }).strict()
  }, async ({ content_drift_id, reason, base_approved_revision_id, source_graph_revision_id, specification }) => toToolResult(() => {
    const result = service.adoptContentDrift({ contentDriftId: content_drift_id, reason,
      baseApprovedRevisionId: base_approved_revision_id, sourceGraphRevisionId: source_graph_revision_id,
      specification: toTicketSpecInput(specification) });
    return success({ ...serializeContentDriftResolution(result),
      proposed_implementation_targets: result.proposedImplementationTargets.map(target => ({
        implementation_target_id: target.implementationTargetId, repository_id: target.repositoryId,
        scope: target.scope, identity_action: target.identityAction
      })) }, result.auditLogId);
  }));
}
