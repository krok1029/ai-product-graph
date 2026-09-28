import { registerContentDriftRejectionTools } from "./content-drift-rejection-tools.js";
import { registerContentDriftResolutionReadTools } from "./content-drift-resolution-read-tools.js";
// 外部同步介面集中註冊，只有 full profile 載入。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { registerPlaneObservationReadTools } from "./plane-observation-read-tools.js";
import { registerMappingSyncPlanTools } from "./mapping-sync-plan-tools.js";
import { registerMappingTerminationReadTools } from "./mapping-termination-read-tools.js";
import { registerMappingTerminationCommand } from "./mapping-termination-command.js";
import { registerTicketSyncHealthTools } from "./ticket-sync-health-tools.js";
import { registerSyncHealthTools } from "./sync-health-tools.js";
import { registerMappingSyncTools } from "./mapping-sync-tools.js";
import { registerExternalWorkItemTools } from "./external-work-item-tools.js";
import { registerPlaneExportTools } from "./plane-export-tools.js";
import { registerSyncIntentTools } from "./sync-intent-tools.js";
import { registerExternalContainerTools } from "./external-container-tools.js";

export function registerExternalSyncTools(server: McpServer, service: ProductGraphService) {
  registerContentDriftRejectionTools(server, service);
  registerContentDriftResolutionReadTools(server, service);
  registerPlaneObservationReadTools(server, service);
  registerMappingTerminationCommand(server, service);
  registerMappingTerminationReadTools(server, service);
  registerMappingSyncPlanTools(server, service);
  registerMappingSyncTools(server, service);
  registerSyncHealthTools(server, service);
  registerTicketSyncHealthTools(server, service);
  registerExternalWorkItemTools(server, service);
  registerExternalContainerTools(server, service);
  registerSyncIntentTools(server, service);
  registerPlaneExportTools(server, service);

}
