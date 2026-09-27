// implementation-tools 的 MCP tool 註冊，將協定輸入轉交 application workflow。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { toImplementationBriefInput, toRepositoryContextInput } from "./input-mappers.js";
import { implementationBriefSchema, repositoryContextSchema } from "./schemas.js";
import {
  serializeImplementationBrief,
  serializeImplementationTarget,
  serializeProductBriefVersion,
  serializeRepository,
  serializeRepositoryContextSnapshot,
  serializeTicket,
  serializeTicketRevision
} from "./serializers.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerImplementationTools(server: McpServer, service: ProductGraphService) {
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

}
