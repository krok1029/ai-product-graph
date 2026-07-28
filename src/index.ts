import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./adapters/mcp/server.js";
import { createApp } from "./app.js";

const app = createApp();
const server = createMcpServer(app.service);
const transport = new StdioServerTransport();

process.on("SIGINT", () => {
  void server.close().finally(() => {
    app.close();
    process.exit(0);
  });
});

await server.connect(transport);
console.error(`AI Product Graph MCP server using ${app.config.databasePath}`);
