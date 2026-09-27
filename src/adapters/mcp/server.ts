import { registerPlaneExportTools } from "./plane-export-tools.js";
import { registerSyncIntentTools } from "./sync-intent-tools.js";
import { registerExternalContainerTools } from "./external-container-tools.js";
// MCP server 註冊入口。
//
// 註冊 AI Product Graph 的 MCP tools 與 resources。Validation、serialization
// 與 error envelope 放在鄰近 modules，讓這個檔案專注在把 MCP call routing
// 到 ProductGraphService。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNodeResources } from "./node-resources.js";
import { registerProjectResources } from "./project-resources.js";
import { z } from "zod";
import { registerMarkdownTools } from "./markdown-tools.js";

import type { ProductGraphService } from "../../application/product-graph-service.js";

import { graphNodeTypeSchema, productBriefJsonSchema } from "./schemas.js";
import {
  serializeGraphDraftBatch,
  serializeGraphEdge,
  serializeGraphNode,
  serializeGraphRevision,
  serializeIdea,
  serializeProductBrief,
  serializeProductBriefVersion,
  serializeProject
} from "./serializers.js";
import { registerRepositoryTools } from "./repository-tools.js";
import { success, toToolResult } from "./tool-envelope.js";
import { registerPlanningPrompts } from "./prompts.js";

import { registerTicketTools } from "./ticket-tools.js";

import { registerImplementationTools } from "./implementation-tools.js";

import { registerResultTools } from "./result-tools.js";

export function createMcpServer(service: ProductGraphService): McpServer {
  const server = new McpServer({
    name: "ai-product-graph",
    version: "0.1.0"
  });

  registerExternalContainerTools(server, service);
  registerRepositoryTools(server, service);
  registerSyncIntentTools(server, service);
  registerPlaneExportTools(server, service);
  registerPlanningPrompts(server);

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

  server.registerTool(
    "create_product_brief_draft",
    {
      title: "Create Product Brief Draft",
      description: "Create an immutable draft Product Brief Version.",
      inputSchema: {
        project_id: z.string().min(1),
        source_idea_id: z.string().min(1),
        base_approved_version_id: z.string().min(1).nullable(),
        brief: productBriefJsonSchema
      }
    },
    async ({
      project_id,
      source_idea_id,
      base_approved_version_id,
      brief
    }) =>
      toToolResult(() => {
        const result = service.createProductBriefDraft({
          projectId: project_id,
          sourceIdeaId: source_idea_id,
          baseApprovedVersionId: base_approved_version_id,
          brief
        });
        return success(
          {
            product_brief: serializeProductBrief(result.productBrief),
            version: serializeProductBriefVersion(result.version),
            validation: result.validation
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "approve_product_brief_version",
    {
      title: "Approve Product Brief Version",
      description:
        "Approve a draft Product Brief Version using base-pointer concurrency.",
      inputSchema: {
        product_brief_version_id: z.string().min(1)
      }
    },
    async ({ product_brief_version_id }) =>
      toToolResult(() => {
        const result = service.approveProductBriefVersion(
          product_brief_version_id
        );
        return success(
          {
            product_brief: serializeProductBrief(result.productBrief),
            version: serializeProductBriefVersion(result.version),
            product_intent_reconciliation: {
              status: result.productIntentReconciliation.status,
              current_product_brief_version_id:
                result.productIntentReconciliation
                  .currentProductBriefVersionId,
              last_reconciled_product_brief_version_id:
                result.productIntentReconciliation
                  .lastReconciledProductBriefVersionId
            },
            archived_stale_version_ids: result.archivedStaleVersionIds
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "create_graph_draft_batch",
    {
      title: "Create Graph Draft Batch",
      description:
        "Create an atomic draft batch of scoped product-intent graph changes.",
      inputSchema: {
        project_id: z.string().min(1),
        base_graph_revision_id: z.string().min(1).nullable(),
        source_product_brief_version_id: z.string().min(1),
        reconciliation_summary: z.string().optional(),
        changes: z.array(
          z
            .object({
              change_id: z.string().min(1),
              operation: z.enum(["add","update","archive"]),
              entity_kind: z.enum(["node","edge"]),
              target_id: z.string().min(1).nullable(),
              // 保留所有原始欄位，讓 application 拒絕未宣告欄位（包含 __proto__）。
              payload: z.unknown().refine(
                (value): value is Record<string, unknown> =>
                  typeof value === "object" && value !== null && !Array.isArray(value),
                "payload must be an object."
              )
            })
            .strict()
        )
      }
    },
    async ({
      project_id,
      base_graph_revision_id,
      source_product_brief_version_id,
      reconciliation_summary,
      changes
    }) =>
      toToolResult(() => {
        const result = service.createGraphDraftBatch({
          projectId: project_id,
          baseGraphRevisionId: base_graph_revision_id,
          sourceProductBriefVersionId:
            source_product_brief_version_id,
          ...(reconciliation_summary === undefined
            ? {}
            :{ reconciliationSummary: reconciliation_summary }),
          changes: changes.map(change => ({
            changeId: change.change_id,
            operation: change.operation,
            entityKind: change.entity_kind,
            targetId: change.target_id,
            payload: change.payload
          }))
        });
        return success(
          {
            graph_draft_batch: {
              ...serializeGraphDraftBatch(result.graphDraftBatch),
              change_count: result.changeCount,
              is_noop_reconciliation: result.isNoopReconciliation
            },
            validation: result.validation
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "approve_graph_draft_batch",
    {
      title: "Approve Graph Draft Batch",
      description:
        "Atomically apply a Graph Draft Batch and create a Graph Revision.",
      inputSchema: {
        graph_draft_batch_id: z.string().min(1)
      }
    },
    async ({ graph_draft_batch_id }) =>
      toToolResult(() => {
        const result = service.approveGraphDraftBatch(
          graph_draft_batch_id
        );
        return success(
          {
            graph_draft_batch: serializeGraphDraftBatch(
              result.graphDraftBatch
            ),
            graph_revision: serializeGraphRevision(
              result.graphRevision
            ),
            applied: {
              added_ids: result.applied.addedIds,
              updated_ids: result.applied.updatedIds,
              archived_ids: result.applied.archivedIds,
              is_noop_reconciliation:
                result.applied.isNoopReconciliation,
              reconciliation_summary:
                result.applied.reconciliationSummary
            },
            archived_stale_batch_ids: result.archivedStaleBatchIds,
            product_intent_reconciliation: {
              status: result.productIntentReconciliation.status,
              current_product_brief_version_id:
                result.productIntentReconciliation
                  .currentProductBriefVersionId,
              last_reconciled_product_brief_version_id:
                result.productIntentReconciliation
                  .lastReconciledProductBriefVersionId,
              product_intent_graph_revision_id:
                result.productIntentReconciliation
                  .productIntentGraphRevisionId
            }
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "get_graph_context",
    {
      title: "Get Graph Context",
      description: "Read canonical graph nodes and edges for a Project.",
      inputSchema: {
        project_id: z.string().min(1),
        lifecycle_status: z
          .enum(["active","archived"])
          .default("active"),
        node_types: z.array(graphNodeTypeSchema).optional(),
        max_depth: z.number().int().min(0).max(10).default(2)
      }
    },
    async ({ project_id, lifecycle_status, node_types, max_depth }) =>
      toToolResult(() => {
        const result = service.getGraphContext({
          projectId: project_id,
          lifecycleStatus: lifecycle_status,
          maxDepth: max_depth,
          ...(node_types === undefined? {}:{ nodeTypes: node_types })
        });
        return success({
          graph_revision_id: result.graphRevisionId,
          nodes: result.nodes.map(serializeGraphNode),
          edges: result.edges.map(serializeGraphEdge)
        });
      })
  );

  registerTicketTools(server, service);

  registerImplementationTools(server, service);

  registerResultTools(server, service);

  registerProjectResources(server, service);
  registerNodeResources(server, service);

  registerMarkdownTools(server, service);

  return server;
}
