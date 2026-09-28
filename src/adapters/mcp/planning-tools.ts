// 一個規劃寫入入口負責內容與圖譜，無需額外 graph approval。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { planningContentSchema } from "../../domain/planning.js";
import { serializeGraphNode, serializeGraphRevision } from "./serializers.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerPlanningTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("save_planning_node", {
    title: "Save Planning Node",
    description: "Create, revise or archive Milestone/Spec and atomically update graph relationships without a separate approval. Read get_graph_context for the current base and stale descendants. Archive cascades from a Milestone to its Specs; Tickets retain historical sources.",
    inputSchema: {
      project_id: z.string().min(1),
      base_graph_revision_id: z.string().min(1).nullable(),
      change: z.discriminatedUnion("operation", [
        z.object({ operation: z.literal("save"), node_id: z.string().min(1).optional(),
          parent_node_id: z.string().min(1).optional(), title: z.string().trim().min(1),
          document: planningContentSchema }).strict(),
        z.object({ operation: z.literal("archive"), node_id: z.string().min(1) }).strict()
      ])
    }
  }, async ({ project_id, base_graph_revision_id, change }) => toToolResult(() => {
    const result = change.operation === "save"
      ? service.planning.save({ projectId: project_id, baseGraphRevisionId: base_graph_revision_id,
        nodeId: change.node_id, parentNodeId: change.parent_node_id, title: change.title, document: change.document })
      : service.planning.archive({ projectId: project_id, baseGraphRevisionId: base_graph_revision_id ?? "",
        nodeId: change.node_id });
    return success({ graph_revision: serializeGraphRevision(result.graphRevision),
      node: "node" in result ? serializeGraphNode(result.node) : null,
      archived_node_ids: "archivedNodeIds" in result ? result.archivedNodeIds : [],
      planning: serializePlanningImpact(result.impact) }, result.auditLogId);
  }));
}

export function serializePlanningImpact(impact: ReturnType<ProductGraphService["planning"]["inspect"]>) {
  return { root_node_id: impact.rootNodeId, stale_node_ids: impact.staleNodeIds, affected_ticket_ids: impact.affectedTicketIds };
}
