// MCP resources 只負責傳輸格式，資料範圍與正式版本由 application 決定。
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { ApplicationError } from "../../domain/errors.js";
import {
  serializeGraphEdge, serializeGraphNode, serializeProductBrief,
  serializeProductBriefVersion, serializeProject, serializeTicket
} from "./serializers.js";

export function registerProjectResources(server: McpServer, service: ProductGraphService) {
  server.registerResource("projects", "product-graph://projects", {
    title: "Projects", mimeType: "application/json"
  }, async uri => resourceJson(uri, () => ({
    projects: service.listProjects().projects.map(serializeProject)
  })));

  register("project", "", projectId => {
    const result = service.getProject(projectId);
    return {
      project: serializeProject(result.project),
      counts: {
        ideas: result.counts.ideas, graph_nodes: result.counts.graphNodes,
        tickets: result.counts.tickets
      }
    };
  });
  register("project-brief", "/brief", projectId => {
    const result = service.getProjectBrief(projectId);
    return {
      product_brief: result.productBrief ? serializeProductBrief(result.productBrief) : null,
      version: result.version ? serializeProductBriefVersion(result.version) : null
    };
  });
  register("project-graph", "/graph", projectId => {
    const result = service.getGraphContext({ projectId });
    return {
      graph_revision_id: result.graphRevisionId,
      nodes: result.nodes.map(serializeGraphNode), edges: result.edges.map(serializeGraphEdge)
    };
  });
  register("project-tickets", "/tickets", projectId => ({
    tickets: service.getProjectTickets(projectId).tickets.map(serializeTicket)
  }));

  function register(name: string, suffix: string, read: (projectId: string) => unknown) {
    server.registerResource(name, new ResourceTemplate(
      `product-graph://projects/{projectId}${suffix}`, { list: undefined }
    ), { title: name, mimeType: "application/json" }, async (uri, variables) =>
      resourceJson(uri, () => read(String(variables.projectId))));
  }
}

export function resourceJson(uri: URL, read: () => unknown) {
  try {
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(read(), null, 2) }] };
  } catch (error) {
    if (error instanceof ApplicationError) {
      // Resource 不使用 ToolResult envelope；保留 domain code 於 MCP error data。
      const code = error.code === "NOT_FOUND" ? -32002
        : error.code === "CONFLICT" || error.code === "VALIDATION_ERROR"
          ? ErrorCode.InvalidParams : ErrorCode.InternalError;
      throw new McpError(code,
        error.message, { code: error.code, details: error.details });
    }
    throw error;
  }
}
