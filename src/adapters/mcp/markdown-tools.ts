// Markdown 匯出只回傳內容與建議檔名，由 client 決定是否保存檔案。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderImplementationBrief } from "../markdown/implementation-brief.js";
import { renderTicketRevision } from "../markdown/ticket-revision.js";
import { renderProductBrief } from "../markdown/product-brief.js";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerMarkdownTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("export_markdown_draft", {
    title: "Export Markdown Draft",
    description: "Render an active draft or approved artifact for human review without modifying it.",
    inputSchema: {
      entity_type: z.enum(["product_brief_version", "ticket_revision", "implementation_brief"]),
      entity_id: z.string().trim().min(1)
    }
  }, async input => toToolResult(() => {
    const artifact = service.getMarkdownExportArtifact({
      entityType: input.entity_type, entityId: input.entity_id
    });
    const result = artifact.entityType === "product_brief_version"
      ? renderProductBrief(artifact.version)
      : artifact.entityType === "ticket_revision"
        ? renderTicketRevision(artifact.revision)
        : renderImplementationBrief(artifact);
    return success({ markdown: result.markdown, suggested_filename: result.suggestedFilename });
  }));
}
