// MCP server 註冊入口。
//
// 註冊 AI Product Graph 的 MCP tools 與 resources。Validation、serialization
// 與 error envelope 放在鄰近 modules，讓這個檔案專注在把 MCP call routing
// 到 ProductGraphService。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectResources } from "./project-resources.js";
import { z } from "zod";

import type { ProductGraphService } from "../../application/product-graph-service.js";
import {
  toImplementationBriefInput,
  toRepositoryContextInput,
  toTicketSpecInput
} from "./input-mappers.js";
import {
  graphNodeTypeSchema,
  implementationBriefSchema,
  productBriefJsonSchema,
  repositoryContextSchema,
  ticketSpecificationSchema
} from "./schemas.js";
import {
  serializeGraphDraftBatch,
  serializeGraphEdge,
  serializeGraphNode,
  serializeGraphRevision,
  serializeIdea,
  serializeImplementationBrief,
  serializeImplementationTarget,
  serializeProductBrief,
  serializeProductBriefVersion,
  serializeProject,
  serializeRepository,
  serializeRepositoryContextSnapshot,
  serializeTicket,
  serializeTicketDraftBatch,
  serializeTicketRevision
} from "./serializers.js";
import { registerRepositoryTools } from "./repository-tools.js";
import { success, toToolResult } from "./tool-envelope.js";
import { registerPlanningPrompts } from "./prompts.js";

export function createMcpServer(service: ProductGraphService): McpServer {
  const server = new McpServer({
    name: "ai-product-graph",
    version: "0.1.0"
  });

  registerRepositoryTools(server, service);
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
              payload: z.record(z.unknown())
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

  server.registerTool(
    "create_ticket_draft_batch",
    {
      title: "Create Ticket Draft Batch",
      description:
        "Create draft Tickets and first Ticket Revisions from graph context.",
      inputSchema: {
        project_id: z.string().min(1),
        source_graph_revision_id: z.string().min(1),
        source_node_ids: z.array(z.string().min(1)),
        tickets: z.array(ticketSpecificationSchema)
      }
    },
    async ({
      project_id,
      source_graph_revision_id,
      source_node_ids,
      tickets
    }) =>
      toToolResult(() => {
        const result = service.createTicketDraftBatch({
          projectId: project_id,
          sourceGraphRevisionId: source_graph_revision_id,
          sourceNodeIds: source_node_ids,
          tickets: tickets.map(toTicketSpecInput)
        });
        return success(
          {
            ticket_draft_batch: serializeTicketDraftBatch(
              result.ticketDraftBatch
            ),
            tickets: result.tickets.map(item => ({
              ticket: serializeTicket(item.ticket),
              revision: serializeTicketRevision(item.revision),
              proposed_implementation_targets:
                item.proposedImplementationTargets.map(target => ({
                  implementation_target_id:
                    target.implementationTargetId,
                  repository_id: target.repositoryId,
                  scope: target.scope,
                  identity_action: target.identityAction
                }))
            })),
            validation: result.validation
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "create_ticket_revision_draft",
    {
      title: "Create Ticket Revision Draft",
      description:
        "Create an immutable draft Ticket Revision for an existing Ticket.",
      inputSchema: {
        ticket_id: z.string().min(1),
        base_approved_revision_id: z.string().min(1),
        source_graph_revision_id: z.string().min(1),
        specification: ticketSpecificationSchema
      }
    },
    async ({
      ticket_id,
      base_approved_revision_id,
      source_graph_revision_id,
      specification
    }) =>
      toToolResult(() => {
        const result = service.createTicketRevisionDraft({
          ticketId: ticket_id,
          baseApprovedRevisionId: base_approved_revision_id,
          sourceGraphRevisionId: source_graph_revision_id,
          specification: toTicketSpecInput(specification)
        });
        return success(
          {
            ticket: serializeTicket(result.ticket),
            revision: serializeTicketRevision(result.revision),
            proposed_implementation_targets:
              result.proposedImplementationTargets.map(target => ({
                implementation_target_id: target.implementationTargetId,
                repository_id: target.repositoryId,
                scope: target.scope,
                identity_action: target.identityAction
              })),
            archived_stale_revision_ids:
              result.archivedStaleRevisionIds
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "approve_ticket_revision",
    {
      title: "Approve Ticket Revision",
      description: "Approve one Ticket Revision.",
      inputSchema: {
        ticket_revision_id: z.string().min(1)
      }
    },
    async ({ ticket_revision_id }) =>
      toToolResult(() => {
        const result = service.approveTicketRevision(ticket_revision_id);
        return success(
          {
            ticket: serializeTicket(result.ticket),
            revision: serializeTicketRevision(result.revision),
            implementation_targets:
              result.implementationTargets.targets.map(target =>
                serializeImplementationTarget(target)
              ),
            archived_implementation_target_ids:
              result.archivedImplementationTargetIds,
            archived_implementation_brief_ids:
              result.archivedImplementationBriefIds,
            archived_implementation_result_ids:
              result.archivedImplementationResultIds,
            archived_stale_revision_ids:
              result.archivedStaleRevisionIds,
            created_sync_intent_ids: result.createdSyncIntentIds
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "get_ticket_context",
    {
      title: "Get Ticket Context",
      description: "Read current approved Ticket implementation context.",
      inputSchema: {
        ticket_id: z.string().min(1),
        include_markdown: z.boolean().default(false)
      }
    },
    async ({ ticket_id, include_markdown }) =>
      toToolResult(() => {
        const result = service.getTicketContext({
          ticketId: ticket_id,
          includeMarkdown: include_markdown
        });
        return success({
          ticket: serializeTicket(result.ticket),
          revision: serializeTicketRevision(result.revision),
          related_nodes: result.relatedNodes.map(serializeGraphNode),
          related_edges: result.relatedEdges.map(serializeGraphEdge),
          markdown: result.markdown
        });
      })
  );

  server.registerTool(
    "create_implementation_brief_draft",
    {
      title: "Create Implementation Brief Draft",
      description:
        "Create an immutable draft Implementation Brief with client-supplied repository context.",
      inputSchema: {
        implementation_target_id: z.string().min(1),
        supersedes_implementation_brief_id:
          z.string().min(1).nullable().optional(),
        repo_context: repositoryContextSchema,
        brief: implementationBriefSchema
      }
    },
    async ({
      implementation_target_id,
      supersedes_implementation_brief_id,
      repo_context,
      brief
    }) =>
      toToolResult(() => {
        const result = service.createImplementationBriefDraft({
          implementationTargetId: implementation_target_id,
          supersedesImplementationBriefId:
            supersedes_implementation_brief_id ?? null,
          repoContext: toRepositoryContextInput(repo_context),
          brief: toImplementationBriefInput(brief)
        });
        return success(
          {
            implementation_brief: serializeImplementationBrief(
              result.implementationBrief
            ),
            repository_context_snapshot:
              serializeRepositoryContextSnapshot(
                result.repositoryContextSnapshot
              )
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "approve_implementation_brief",
    {
      title: "Approve Implementation Brief",
      description: "Approve one Implementation Brief.",
      inputSchema: {
        implementation_brief_id: z.string().min(1)
      }
    },
    async ({ implementation_brief_id }) =>
      toToolResult(() => {
        const result = service.approveImplementationBrief(
          implementation_brief_id
        );
        return success(
          {
            implementation_brief: serializeImplementationBrief(
              result.implementationBrief
            ),
            archived_implementation_brief_id:
              result.archivedImplementationBriefId
          },
          result.auditLogId
        );
      })
  );

  server.registerTool(
    "get_implementation_handoff",
    {
      title: "Get Implementation Handoff",
      description:
        "Validate Implementation Brief freshness and return handoff context.",
      inputSchema: {
        implementation_brief_id: z.string().min(1),
        current_repository_state: z
          .object({
            commit_sha: z.string().min(1),
            dirty_state_fingerprint:
              z.string().min(1).nullable().optional()
          })
          .strict()
      }
    },
    async ({ implementation_brief_id, current_repository_state }) =>
      toToolResult(() => {
        const result = service.getImplementationHandoff({
          implementationBriefId: implementation_brief_id,
          currentRepositoryState: {
            commitSha: current_repository_state.commit_sha,
            dirtyStateFingerprint:
              current_repository_state.dirty_state_fingerprint ?? null
          }
        });
        return success({
          freshness: result.freshness,
          implementation_brief: serializeImplementationBrief(
            result.implementationBrief
          ),
          implementation_target: serializeImplementationTarget(
            result.implementationTarget
          ),
          ticket: serializeTicket(result.ticket),
          ticket_revision: serializeTicketRevision(result.ticketRevision),
          product_brief_version: serializeProductBriefVersion(
            result.productBriefVersion
          ),
          repository: serializeRepository(result.repository),
          repository_context_snapshot: serializeRepositoryContextSnapshot(
            result.repositoryContextSnapshot
          )
        });
      })
  );

  registerProjectResources(server, service);

  return server;
}
