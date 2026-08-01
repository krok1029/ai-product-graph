import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ProductGraphService } from "../../application/product-graph-service.js";
import { ApplicationError } from "../../domain/errors.js";
import type {
  GraphDraftBatch,
  GraphEdge,
  GraphNode,
  GraphRevision,
  ImplementationBrief,
  ImplementationTarget,
  Idea,
  ProductBrief,
  ProductBriefVersion,
  Project,
  Repository,
  RepositoryContextSnapshot,
  Ticket,
  TicketDraftBatch,
  TicketRevision
} from "../../domain/models.js";

const graphNodeTypeSchema = z.enum([
  "idea",
  "product_goal",
  "persona",
  "pain_point",
  "workflow",
  "feature_area",
  "epic",
  "ticket",
  "acceptance_criterion",
  "decision",
  "repository",
  "code_file",
  "pull_request",
  "test_case",
  "release",
  "feedback",
  "implementation_target",
  "external_work_item"
]);

const productBriefJsonSchema = z
  .object({
    product_goal: z.string().min(1),
    target_users: z.array(
      z
        .object({
          name: z.string(),
          description: z.string()
        })
        .strict()
    ),
    pain_points: z.array(
      z
        .object({
          title: z.string(),
          description: z.string()
        })
        .strict()
    ),
    core_workflows: z.array(
      z
        .object({
          title: z.string(),
          steps: z.array(z.string())
        })
        .strict()
    ),
    mvp_scope: z.array(z.string()),
    non_goals: z.array(z.string()),
    success_metrics: z.array(z.string()),
    risks: z.array(z.string()),
    open_questions: z.array(z.string())
  })
  .strict();

const ticketSpecificationSchema = z
  .object({
    title: z.string().min(1),
    traces_to_ticket_id: z.string().min(1).nullable().optional(),
    user_story: z.string().min(1),
    scope: z.array(z.string()),
    acceptance_criteria: z.array(z.string().min(1)),
    non_goals: z.array(z.string()),
    related_graph_node_ids: z.array(z.string().min(1)),
    dependencies: z.array(z.string().min(1)).optional(),
    implementation_targets: z.array(
      z
        .object({
          repository_id: z.string().min(1),
          scope: z.array(z.string())
        })
        .strict()
    ),
    implementation_notes: z.array(z.string())
  })
  .strict();

const repositoryContextSchema = z
  .object({
    repository_name: z.string().min(1),
    summary: z.string().min(1),
    file_list: z.array(z.string().min(1)),
    module_notes: z.array(z.string().min(1)),
    baseline_commit_sha: z.string().min(1).nullable().optional(),
    has_uncommitted_changes: z.boolean().default(false),
    dirty_state_fingerprint: z.string().min(1).nullable().optional()
  })
  .strict();

const implementationBriefSchema = z
  .object({
    implementation_plan: z.array(z.string().min(1)),
    suggested_files_to_inspect: z.array(z.string().min(1)),
    test_strategy: z.array(z.string().min(1)),
    risks: z.array(z.string().min(1)),
    pr_summary_draft: z.string().min(1)
  })
  .strict();

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
              operation: z.enum(["add", "update", "archive"]),
              entity_kind: z.enum(["node", "edge"]),
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
            : { reconciliationSummary: reconciliation_summary }),
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
          .enum(["active", "archived"])
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
          ...(node_types === undefined ? {} : { nodeTypes: node_types })
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
    current_product_brief_id: project.currentProductBriefId,
    current_graph_revision_id: project.currentGraphRevisionId,
    last_reconciled_product_brief_version_id:
      project.lastReconciledProductBriefVersionId,
    product_intent_graph_revision_id: project.productIntentGraphRevisionId,
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

function serializeProductBrief(productBrief: ProductBrief) {
  return {
    id: productBrief.id,
    project_id: productBrief.projectId,
    source_idea_id: productBrief.sourceIdeaId,
    slug: productBrief.slug,
    current_approved_version_id: productBrief.currentApprovedVersionId,
    lifecycle_status: productBrief.lifecycleStatus,
    created_at: productBrief.createdAt,
    updated_at: productBrief.updatedAt
  };
}

function serializeProductBriefVersion(version: ProductBriefVersion) {
  return {
    id: version.id,
    product_brief_id: version.productBriefId,
    project_id: version.projectId,
    version_number: version.versionNumber,
    base_approved_version_id: version.baseApprovedVersionId,
    brief: version.brief,
    review_status: version.reviewStatus,
    lifecycle_status: version.lifecycleStatus,
    approved_by_actor_id: version.approvedByActorId,
    approved_at: version.approvedAt,
    created_at: version.createdAt,
    updated_at: version.updatedAt
  };
}

function serializeGraphDraftBatch(batch: GraphDraftBatch) {
  return {
    id: batch.id,
    project_id: batch.projectId,
    source_product_brief_version_id:
      batch.sourceProductBriefVersionId,
    base_graph_revision_id: batch.baseGraphRevisionId,
    reconciliation_summary: batch.reconciliationSummary,
    review_status: batch.reviewStatus,
    lifecycle_status: batch.lifecycleStatus,
    approved_by_actor_id: batch.approvedByActorId,
    approved_at: batch.approvedAt,
    created_at: batch.createdAt,
    updated_at: batch.updatedAt
  };
}

function serializeGraphRevision(revision: GraphRevision) {
  return {
    id: revision.id,
    project_id: revision.projectId,
    graph_draft_batch_id: revision.graphDraftBatchId,
    source_product_brief_version_id:
      revision.sourceProductBriefVersionId,
    sequence_number: revision.sequenceNumber,
    is_noop_reconciliation: revision.isNoopReconciliation,
    reconciliation_summary: revision.reconciliationSummary,
    created_at: revision.createdAt
  };
}

function serializeGraphNode(node: GraphNode) {
  return {
    id: node.id,
    project_id: node.projectId,
    slug: node.slug,
    type: node.type,
    title: node.title,
    description: node.description,
    source: node.source,
    source_ref_type: node.sourceRefType,
    source_ref_id: node.sourceRefId,
    lifecycle_status: node.lifecycleStatus,
    created_in_graph_revision_id: node.createdInGraphRevisionId,
    last_changed_in_graph_revision_id:
      node.lastChangedInGraphRevisionId,
    metadata: node.metadata,
    created_at: node.createdAt,
    updated_at: node.updatedAt
  };
}

function serializeGraphEdge(edge: GraphEdge) {
  return {
    id: edge.id,
    project_id: edge.projectId,
    source_node_id: edge.sourceNodeId,
    target_node_id: edge.targetNodeId,
    relation_type: edge.relationType,
    confidence: edge.confidence,
    lifecycle_status: edge.lifecycleStatus,
    created_in_graph_revision_id: edge.createdInGraphRevisionId,
    last_changed_in_graph_revision_id:
      edge.lastChangedInGraphRevisionId,
    metadata: edge.metadata,
    created_at: edge.createdAt,
    updated_at: edge.updatedAt
  };
}

function serializeTicketDraftBatch(batch: TicketDraftBatch) {
  return {
    id: batch.id,
    project_id: batch.projectId,
    source_graph_revision_id: batch.sourceGraphRevisionId,
    lifecycle_status: batch.lifecycleStatus,
    created_at: batch.createdAt,
    updated_at: batch.updatedAt
  };
}

function serializeTicket(ticket: Ticket) {
  return {
    id: ticket.id,
    project_id: ticket.projectId,
    slug: ticket.slug,
    title: ticket.title,
    current_approved_revision_id: ticket.currentApprovedRevisionId,
    lifecycle_status: ticket.lifecycleStatus,
    delivery_status: ticket.deliveryStatus,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt
  };
}

function serializeTicketRevision(revision: TicketRevision) {
  return {
    id: revision.id,
    ticket_id: revision.ticketId,
    project_id: revision.projectId,
    ticket_draft_batch_id: revision.ticketDraftBatchId,
    revision_number: revision.revisionNumber,
    base_approved_revision_id: revision.baseApprovedRevisionId,
    source_graph_revision_id: revision.sourceGraphRevisionId,
    title: revision.title,
    specification: revision.specification,
    required_targets: revision.requiredTargets,
    review_status: revision.reviewStatus,
    lifecycle_status: revision.lifecycleStatus,
    approved_by_actor_id: revision.approvedByActorId,
    approved_at: revision.approvedAt,
    created_at: revision.createdAt,
    updated_at: revision.updatedAt
  };
}

function serializeImplementationTarget(
  target: ImplementationTarget & { identityAction?: "created" | "reused" }
) {
  return {
    id: target.id,
    project_id: target.projectId,
    ticket_id: target.ticketId,
    repository_id: target.repositoryId,
    lifecycle_status: target.lifecycleStatus,
    identity_action: target.identityAction,
    created_at: target.createdAt,
    updated_at: target.updatedAt
  };
}

function serializeRepository(repository: Repository) {
  return {
    id: repository.id,
    project_id: repository.projectId,
    slug: repository.slug,
    name: repository.name,
    root_path: repository.rootPath,
    remote_url: repository.remoteUrl,
    lifecycle_status: repository.lifecycleStatus,
    created_at: repository.createdAt,
    updated_at: repository.updatedAt
  };
}

function serializeRepositoryContextSnapshot(
  snapshot: RepositoryContextSnapshot
) {
  return {
    id: snapshot.id,
    project_id: snapshot.projectId,
    repository_id: snapshot.repositoryId,
    baseline_commit_sha: snapshot.baselineCommitSha,
    dirty_state_fingerprint: snapshot.dirtyStateFingerprint,
    context: snapshot.context,
    is_approvable: snapshot.isApprovable,
    created_at: snapshot.createdAt
  };
}

function serializeImplementationBrief(brief: ImplementationBrief) {
  return {
    id: brief.id,
    project_id: brief.projectId,
    implementation_target_id: brief.implementationTargetId,
    ticket_revision_id: brief.ticketRevisionId,
    product_brief_version_id: brief.productBriefVersionId,
    repository_context_snapshot_id: brief.repositoryContextSnapshotId,
    supersedes_implementation_brief_id:
      brief.supersedesImplementationBriefId,
    slug: brief.slug,
    brief: brief.brief,
    review_status: brief.reviewStatus,
    lifecycle_status: brief.lifecycleStatus,
    approved_by_actor_id: brief.approvedByActorId,
    approved_at: brief.approvedAt,
    created_at: brief.createdAt,
    updated_at: brief.updatedAt
  };
}

function toTicketSpecInput(
  input: z.infer<typeof ticketSpecificationSchema>
) {
  return {
    title: input.title,
    tracesToTicketId: input.traces_to_ticket_id ?? null,
    userStory: input.user_story,
    scope: input.scope,
    acceptanceCriteria: input.acceptance_criteria,
    nonGoals: input.non_goals,
    relatedGraphNodeIds: input.related_graph_node_ids,
    dependencies: input.dependencies ?? [],
    implementationTargets: input.implementation_targets.map(target => ({
      repositoryId: target.repository_id,
      scope: target.scope
    })),
    implementationNotes: input.implementation_notes
  };
}

function toRepositoryContextInput(
  input: z.infer<typeof repositoryContextSchema>
) {
  return {
    repositoryName: input.repository_name,
    summary: input.summary,
    fileList: input.file_list,
    moduleNotes: input.module_notes,
    baselineCommitSha: input.baseline_commit_sha ?? null,
    hasUncommittedChanges: input.has_uncommitted_changes,
    dirtyStateFingerprint: input.dirty_state_fingerprint ?? null
  };
}

function toImplementationBriefInput(
  input: z.infer<typeof implementationBriefSchema>
) {
  return {
    implementationPlan: input.implementation_plan,
    suggestedFilesToInspect: input.suggested_files_to_inspect,
    testStrategy: input.test_strategy,
    risks: input.risks,
    prSummaryDraft: input.pr_summary_draft
  };
}
