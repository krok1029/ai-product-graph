import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";

import { createMcpServer } from "./server.js";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";

it("runs the Graph reconciliation workflow through MCP", async () => {
  const database = openDatabase(":memory:");
  const service = new ProductGraphService(createSqlitePorts(database), {
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
        "get_graph_context"
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
