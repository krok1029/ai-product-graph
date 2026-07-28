import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ProductGraphService } from "../../application/product-graph-service.js";
import { ApplicationError } from "../../domain/errors.js";
import type { Idea, Project } from "../../domain/models.js";

export function createMcpServer(service: ProductGraphService): McpServer {
  const server = new McpServer({
    name: "ai-product-graph",
    version: "0.1.0"
  });

  server.registerTool(
    "create_project",
    {
      title: "Create Project",
      description: "Create an AI Product Graph project.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional()
      }
    },
    async input =>
      toToolResult(() => {
        const result = service.createProject(input);
        return success(
          { project: serializeProject(result.project) },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "List AI Product Graph projects.",
      inputSchema: {}
    },
    async () =>
      toToolResult(() =>
        success({
          projects: service.listProjects().projects.map(serializeProject)
        })
      )
  );

  server.registerTool(
    "get_project",
    {
      title: "Get Project",
      description: "Read an AI Product Graph project summary.",
      inputSchema: {
        project_id: z.string().min(1)
      }
    },
    async ({ project_id }) =>
      toToolResult(() => {
        const result = service.getProject(project_id);
        return success({
          project: serializeProject(result.project),
          counts: {
            ideas: result.counts.ideas,
            graph_nodes: result.counts.graphNodes,
            tickets: result.counts.tickets
          }
        });
      })
  );

  server.registerTool(
    "add_idea",
    {
      title: "Add Idea",
      description: "Save a raw Idea Record in a Project.",
      inputSchema: {
        project_id: z.string().min(1),
        content: z.string().min(1),
        source: z.string().min(1)
      }
    },
    async ({ project_id, content, source }) =>
      toToolResult(() => {
        const result = service.addIdea({
          projectId: project_id,
          content,
          source
        });
        return success(
          { idea: serializeIdea(result.idea) },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "get_idea",
    {
      title: "Get Idea",
      description: "Read a raw Idea Record.",
      inputSchema: {
        idea_id: z.string().min(1)
      }
    },
    async ({ idea_id }) =>
      toToolResult(() =>
        success({ idea: serializeIdea(service.getIdea(idea_id).idea) })
      )
  );

  server.registerResource(
    "projects",
    "product-graph://projects",
    {
      title: "Projects",
      description: "All AI Product Graph projects.",
      mimeType: "application/json"
    },
    async uri => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              projects: service.listProjects().projects.map(serializeProject)
            },
            null,
            2
          )
        }
      ]
    })
  );

  server.registerResource(
    "project",
    new ResourceTemplate("product-graph://projects/{projectId}", {
      list: undefined
    }),
    {
      title: "Project",
      description: "An AI Product Graph project summary.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId);
      const result = service.getProject(projectId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                project: serializeProject(result.project),
                counts: {
                  ideas: result.counts.ideas,
                  graph_nodes: result.counts.graphNodes,
                  tickets: result.counts.tickets
                }
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  return server;
}

type ToolEnvelope = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  audit_log_id?: string;
};

function success(
  data: Record<string, unknown>,
  auditLogId?: string
): ToolEnvelope {
  return {
    ok: true,
    data,
    ...(auditLogId ? { audit_log_id: auditLogId } : {})
  };
}

function toToolResult(work: () => ToolEnvelope) {
  try {
    const envelope = work();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      structuredContent: { ...envelope }
    };
  } catch (error) {
    const envelope = errorEnvelope(error);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      isError: true
    };
  }
}

function errorEnvelope(error: unknown): ToolEnvelope {
  if (error instanceof ApplicationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    };
  }
  if (isSqliteError(error)) {
    return {
      ok: false,
      error: {
        code: "STORAGE_ERROR",
        message: "SQLite operation failed.",
        details: { sqlite_code: error.code }
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error."
    }
  };
}

function isSqliteError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_")
  );
}

function serializeProject(project: Project) {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    lifecycle_status: project.lifecycleStatus,
    created_at: project.createdAt,
    updated_at: project.updatedAt
  };
}

function serializeIdea(idea: Idea) {
  return {
    id: idea.id,
    project_id: idea.projectId,
    slug: idea.slug,
    content: idea.content,
    source: idea.source,
    lifecycle_status: idea.lifecycleStatus,
    created_at: idea.createdAt,
    updated_at: idea.updatedAt
  };
}
