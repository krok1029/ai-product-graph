// ticket-tools 的 MCP tool 註冊，將協定輸入轉交 application workflow。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { toTicketSpecInput } from "./input-mappers.js";
import { ticketSpecificationSchema } from "./schemas.js";
import {
  serializeGraphEdge,
  serializeGraphNode,
  serializeImplementationTarget,
  serializeTicket,
  serializeTicketDraftBatch,
  serializeTicketRevision
} from "./serializers.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerTicketTools(server: McpServer, service: ProductGraphService) {
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
            created_sync_intent_ids: result.createdSyncIntentIds,
            sync_health: result.syncHealth
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
          traced_ticket: result.tracedTicket ? serializeTicket(result.tracedTicket) : null,
          trace_edge: result.traceEdge ? serializeGraphEdge(result.traceEdge) : null,
          markdown: result.markdown
        });
      })
  );

}
