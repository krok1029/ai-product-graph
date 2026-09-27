// Markdown 匯出只回傳內容與建議檔名，由 client 決定是否保存檔案。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { success, toToolResult } from "./tool-envelope.js";

export function registerMarkdownTools(server: McpServer, service: ProductGraphService) {
  server.registerTool("export_markdown_draft", {
    title: "Export Markdown Draft",
    description: "Render an active draft or approved artifact for human review without modifying it.",
    inputSchema: {
      entity_type: z.enum(["product_brief_version"]),
      entity_id: z.string().trim().min(1)
    }
  }, async input => toToolResult(() => {
    const result = service.exportMarkdownDraft({
      entityType: input.entity_type, entityId: input.entity_id
    });
    return success({ markdown: result.markdown, suggested_filename: result.suggestedFilename });
  }));
}
