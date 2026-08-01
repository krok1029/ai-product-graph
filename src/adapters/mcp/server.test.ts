import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";

import { createMcpServer } from "./server.js";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";

it("runs the Graph reconciliation workflow through MCP", async () => {
  const database = openDatabase(":memory:");
  const ports = createSqlitePorts(database);
  const service = new ProductGraphService(ports, {
    actor: {
      id: "00000000000000000000000004",
      displayName: "MCP Test User"
    }
  });
  const server = createMcpServer(service);
  const client = new Client({
    name: "ai-product-graph-test",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual(
      expect.arrayContaining([
        "create_graph_draft_batch",
        "approve_graph_draft_batch",
        "get_graph_context",
        "create_ticket_draft_batch",
        "approve_ticket_revision",
        "get_ticket_context",
        "create_implementation_brief_draft",
        "approve_implementation_brief",
        "get_implementation_handoff"
      ])
    );

    const project = toolData(
      await client.callTool({
        name: "create_project",
        arguments: { name: "MCP Graph Test" }
      })
    ).project as { id: string };
    const idea = toolData(
      await client.callTool({
        name: "add_idea",
        arguments: {
          project_id: project.id,
          content: "Verify graph reconciliation through MCP.",
          source: "test"
        }
      })
    ).idea as { id: string };
    const briefDraft = toolData(
      await client.callTool({
        name: "create_product_brief_draft",
        arguments: {
          project_id: project.id,
          source_idea_id: idea.id,
          base_approved_version_id: null,
          brief: {
            product_goal: "Verify the MCP graph workflow.",
            target_users: [],
            pain_points: [],
            core_workflows: [],
            mvp_scope: [],
            non_goals: [],
            success_metrics: [],
            risks: [],
            open_questions: []
          }
        }
      })
    ).version as { id: string };
    await client.callTool({
      name: "approve_product_brief_version",
      arguments: { product_brief_version_id: briefDraft.id }
    });
    const graphDraft = toolData(
      await client.callTool({
        name: "create_graph_draft_batch",
        arguments: {
          project_id: project.id,
          base_graph_revision_id: null,
          source_product_brief_version_id: briefDraft.id,
          changes: [
            {
              change_id: "goal",
              operation: "add",
              entity_kind: "node",
              target_id: null,
              payload: {
                type: "product_goal",
                title: "Trace product intent"
              }
            }
          ]
        }
      })
    ).graph_draft_batch as { id: string };
    const approval = toolData(
      await client.callTool({
        name: "approve_graph_draft_batch",
        arguments: { graph_draft_batch_id: graphDraft.id }
      })
    );
    const graphRevisionId = (
      approval.graph_revision as { id: string }
    ).id;
    const context = toolData(
      await client.callTool({
        name: "get_graph_context",
        arguments: {
          project_id: project.id,
          lifecycle_status: "active",
          max_depth: 2
        }
      })
    );

    expect(
      (approval.product_intent_reconciliation as { status: string }).status
    ).toBe("current");
    expect(context.nodes).toHaveLength(1);
    expect(context.edges).toHaveLength(0);

    const graphNodeId = ((context.nodes as Array<{ id: string }>)[0] as {
      id: string;
    }).id;
    const repository = {
      id: "01MCPREPOSITORY0000000001",
      projectId: project.id,
      slug: "app",
      name: "App Repository",
      rootPath: null,
      remoteUrl: null,
      lifecycleStatus: "active" as const,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z"
    };
    ports.repositories.insert(repository);
    const ticketDraft = toolData(
      await client.callTool({
        name: "create_ticket_draft_batch",
        arguments: {
          project_id: project.id,
          source_graph_revision_id: graphRevisionId,
          source_node_ids: [graphNodeId],
          tickets: [
            {
              title: "Build countdown preset controls",
              user_story:
                "As a user, I can start a preset countdown quickly.",
              scope: ["Add preset controls"],
              acceptance_criteria: [
                "A user can start a preset countdown in one tap."
              ],
              non_goals: [],
              related_graph_node_ids: [graphNodeId],
              implementation_targets: [
                {
                  repository_id: repository.id,
                  scope: ["Timer controls"]
                }
              ],
              implementation_notes: []
            }
          ]
        }
      })
    );
    const ticketRevisionId = (
      (ticketDraft.tickets as Array<{ revision: { id: string } }>)[0] as {
        revision: { id: string };
      }
    ).revision.id;
    const ticketApproval = toolData(
      await client.callTool({
        name: "approve_ticket_revision",
        arguments: { ticket_revision_id: ticketRevisionId }
      })
    );
    const ticketId = (ticketApproval.ticket as { id: string }).id;
    const ticketContext = toolData(
      await client.callTool({
        name: "get_ticket_context",
        arguments: {
          ticket_id: ticketId,
          include_markdown: true
        }
      })
    );

    expect((ticketApproval.revision as { review_status: string }).review_status)
      .toBe("approved");
    expect(ticketContext.related_nodes).toHaveLength(1);
    expect(ticketContext.markdown).toContain("## Acceptance Criteria");

    const implementationTargetId = (
      (ticketApproval.implementation_targets as Array<{ id: string }>)[0] as {
        id: string;
      }
    ).id;
    const implementationBriefDraft = toolData(
      await client.callTool({
        name: "create_implementation_brief_draft",
        arguments: {
          implementation_target_id: implementationTargetId,
          supersedes_implementation_brief_id: null,
          repo_context: {
            repository_name: repository.name,
            summary: "MCP test repository context.",
            file_list: ["src/App.tsx"],
            module_notes: ["Timer controls live in the app shell."],
            baseline_commit_sha: "abc123",
            has_uncommitted_changes: false,
            dirty_state_fingerprint: null
          },
          brief: {
            implementation_plan: ["Add preset buttons"],
            suggested_files_to_inspect: ["src/App.tsx"],
            test_strategy: ["Run timer UI tests"],
            risks: ["Mobile layout may need adjustment"],
            pr_summary_draft: "Add preset countdown controls."
          }
        }
      })
    ).implementation_brief as { id: string };
    const briefApproval = toolData(
      await client.callTool({
        name: "approve_implementation_brief",
        arguments: { implementation_brief_id: implementationBriefDraft.id }
      })
    ).implementation_brief as { id: string; review_status: string };
    const handoff = toolData(
      await client.callTool({
        name: "get_implementation_handoff",
        arguments: {
          implementation_brief_id: briefApproval.id,
          current_repository_state: {
            commit_sha: "abc123",
            dirty_state_fingerprint: null
          }
        }
      })
    );

    expect(briefApproval.review_status).toBe("approved");
    expect((handoff as { freshness: string }).freshness).toBe("current");
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
    database.close();
  }
});

function toolData(result: {
  structuredContent?: Record<string, unknown>;
}): Record<string, unknown> {
  const data = result.structuredContent?.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("MCP tool did not return structured data.");
  }
  return data as Record<string, unknown>;
}
