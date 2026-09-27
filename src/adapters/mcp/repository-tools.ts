import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ProductGraphService } from "../../application/product-graph-service.js";
import { serializeRepository } from "./serializers.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerRepositoryTools(server: McpServer, service: ProductGraphService) {
  server.registerTool(
    "create_repository",
    {
      title: "Create Repository",
      description: "Register a Repository identity in an active Project without scanning files or calling providers.",
      inputSchema: {
        project_id: z.string(),
        slug: z.string(),
        name: z.string(),
        root_path: z.string().nullable().optional(),
        remote_url: z.string().nullable().optional()
      }
    },
    async input => toToolResult(() => {
      const result = service.createRepository({
        projectId: input.project_id,
        slug: input.slug,
        name: input.name,
        rootPath: input.root_path,
        remoteUrl: input.remote_url
      });
      return success({ repository: serializeRepository(result.repository) }, result.auditLogId);
    })
  );

  server.registerTool(
    "list_repositories",
    {
      title: "List Repositories",
      description: "List Repository identities belonging to an active Project, including archived history.",
      inputSchema: { project_id: z.string() }
    },
    async input => toToolResult(() => success({
      repositories: service.listRepositories(input.project_id).repositories.map(serializeRepository)
    }))
  );
}
