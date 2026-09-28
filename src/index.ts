import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./adapters/mcp/server.js";
import { createApp } from "./app.js";

const profile = process.env.AI_PRODUCT_GRAPH_MCP_PROFILE ?? "core";
if (profile !== "core" && profile !== "full") {
  throw new Error("AI_PRODUCT_GRAPH_MCP_PROFILE must be core or full.");
}
const app = createApp();
const server = createMcpServer(app.service, { profile });
const transport = new StdioServerTransport();

process.on("SIGINT", () => {
  void server.close().finally(() => {
    app.close();
    process.exit(0);
  });
});

await server.connect(transport);
console.error(`AI Product Graph MCP server using ${app.config.databasePath}`);
