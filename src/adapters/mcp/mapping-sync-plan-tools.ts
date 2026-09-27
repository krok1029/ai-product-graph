import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MappingSyncPlan } from "../../application/mapping-sync-plan-reads.js";
import type { ProductGraphService } from "../../application/product-graph-service.js";
import { resourceJson } from "./project-resources.js";
import { success, toToolResult } from "./tool-envelope.js";

export function serializeMappingSyncPlan(plan: MappingSyncPlan) {
  const identity = (intent: NonNullable<MappingSyncPlan["nextIntent"]>) => ({ id: intent.id,
    sequence_number: intent.sequenceNumber, operation: intent.operation, source_ticket_revision_id: intent.sourceTicketRevisionId });
  return { mapping_id: plan.mappingId, included: plan.included, state: plan.state,
    next_intent: plan.nextIntent ? identity(plan.nextIntent) : null, blocking_intent_ids: plan.blockingIntentIds,
    entries: plan.entries.map(entry => ({ ...identity(entry), disposition: entry.disposition,
      attempt_state: entry.attemptState, request_state: entry.requestState })),
    reasons: plan.reasons.map(reason => ({ code: reason.code, ...(reason.intentId ? { intent_id: reason.intentId } : {}) })),
    termination_id: plan.terminationId };
}

export function registerMappingSyncPlanTools(server: McpServer, service: ProductGraphService) {
  const description = "Observe ordered synchronization work without writes or provider calls. This is not an execution claim; execution must atomically recheck eligibility and acquire a per-mapping fence.";
  server.registerTool("get_mapping_sync_plan", {
    title: "Get Mapping Sync Plan", description,
    inputSchema: z.object({ mapping_id: z.string().trim().min(1) }).strict()
  }, async ({ mapping_id }) => toToolResult(() => success(serializeMappingSyncPlan(service.getMappingSyncPlan(mapping_id)))));
  server.registerResource("mapping-sync-plan",
    new ResourceTemplate("product-graph://external-work-item-mappings/{mappingId}/sync-plan", { list: undefined }),
    { title: "Mapping sync plan", description, mimeType: "application/json" }, async (uri, variables) =>
      resourceJson(uri, () => serializeMappingSyncPlan(service.getMappingSyncPlan(String(variables.mappingId)))));
}
