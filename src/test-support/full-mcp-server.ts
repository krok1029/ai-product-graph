// 保留舊 MCP 契約測試的明確 full profile，避免依賴產品預設值。
import { createMcpServer } from "../adapters/mcp/server.js";
import type { ProductGraphService } from "../application/product-graph-service.js";
export function createFullMcpServer(service: ProductGraphService) {
  return createMcpServer(service, { profile: "full" });
}
