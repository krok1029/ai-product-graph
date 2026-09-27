// Node 與 Ticket 的讀取介面共用 application 規則，不直接查詢儲存層。
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { resourceJson } from "./project-resources.js";
import { serializeGraphEdge, serializeGraphNode, serializeTicket, serializeTicketRevision } from "./serializers.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerNodeResources(server: McpServer, service: ProductGraphService) {
  server.registerTool("get_node_trace", {
    title: "Get Node Trace",
    description: "Read a bounded, project-scoped active graph trace from a node.",
    inputSchema: {
      node_id: z.string().min(1),
      direction: z.enum(["incoming", "outgoing", "both"]).default("both"),
      max_depth: z.number().int().min(0).max(10).default(3)
    }
  }, async input => toToolResult(() => success(serializeTrace(service.getNodeTrace({
    nodeId: input.node_id, direction: input.direction, maxDepth: input.max_depth
  })))));

  register("ticket", "tickets/{ticketId}", "ticketId", ticketId => ({
    ticket: serializeTicket(service.getTicket(ticketId).ticket)
  }));
  register("ticket-context", "tickets/{ticketId}/context", "ticketId", ticketId => {
    const result = service.getTicketContext({ ticketId });
    return {
      ticket: serializeTicket(result.ticket), revision: serializeTicketRevision(result.revision),
      related_nodes: result.relatedNodes.map(serializeGraphNode),
      related_edges: result.relatedEdges.map(serializeGraphEdge),
      traced_ticket: result.tracedTicket ? serializeTicket(result.tracedTicket) : null,
      trace_edge: result.traceEdge ? serializeGraphEdge(result.traceEdge) : null,
      markdown: result.markdown
    };
  });
  register("node", "nodes/{nodeId}", "nodeId", nodeId => ({
    node: serializeGraphNode(service.getNode(nodeId).node)
  }));
  register("node-trace", "nodes/{nodeId}/trace", "nodeId", nodeId =>
    serializeTrace(service.getNodeTrace({ nodeId })));

  function register(name: string, path: string, parameter: string, read: (id: string) => unknown) {
    server.registerResource(name, new ResourceTemplate(`product-graph://${path}`, { list: undefined }),
      { title: name, mimeType: "application/json" }, async (uri, variables) =>
        resourceJson(uri, () => read(String(variables[parameter]))));
  }
}

function serializeTrace(trace: ReturnType<ProductGraphService["getNodeTrace"]>) {
  return {
    root: serializeGraphNode(trace.root), nodes: trace.nodes.map(serializeGraphNode),
    edges: trace.edges.map(serializeGraphEdge),
    paths: trace.paths.map(path => ({ node_ids: path.nodeIds, edge_ids: path.edgeIds }))
  };
}
