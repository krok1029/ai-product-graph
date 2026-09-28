import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createPlaneCreateProcessor } from "../../application/create-plane-create-processor.js";
import { createFullMcpServer as createMcpServer } from "../../test-support/full-mcp-server.js";
import type { ToolEnvelope } from "./tool-envelope.js";

it("terminates via strict MCP with server identity and reports duplicate termination identity", async () => {
  const f = acceptanceFixture();
  const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
  const intent = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
    externalContainerId: container.id, idempotencyKey: "export" }).syncIntent;
  await createPlaneCreateProcessor(f.ports, { create: async () => ({ status: "succeeded", item: {
    externalId: "item", externalUrl: null, content: {}, externalStatus: "open", concurrencyToken: "v1"
  } }), reconcile: async () => { throw new Error("unexpected reconcile"); } }).process(intent.id, "test");
  const mapping = f.ports.externalWorkItems.listTicketMappings(f.ticket.id)[0]!;
  const server = createMcpServer(f.service);
  const client = new Client({ name: "termination-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const command = { mapping_id: ` ${mapping.id} `, reason: "  Provider no longer used  " };
    const beforeAudit = f.ports.auditLog.list();
    for (const field of ["project_id", "actor_id", "created_at", "decision_id", "idempotency_key"]) {
      const rejected = await client.callTool({ name: "terminate_sync_mapping", arguments: { ...command, [field]: "injected" } });
      expect(rejected.isError).toBe(true);
    }
    expect((await client.callTool({ name: "terminate_sync_mapping", arguments: { ...command, reason: " " } })).isError).toBe(true);
    expect(f.ports.auditLog.list()).toEqual(beforeAudit);
    expect(f.ports.externalWorkItems.findMappingById(mapping.id)).toEqual(mapping);

    const response = await client.callTool({ name: "terminate_sync_mapping", arguments: command });

    expect(response.isError).not.toBe(true);
    const envelope = response.structuredContent as ToolEnvelope;
    const stored = f.ports.syncMappingTerminations.findByMappingId(mapping.id)!;
    expect(envelope).toMatchObject({ ok: true, audit_log_id: expect.any(String), data: {
      mapping: { id: mapping.id, lifecycle_status: "archived", archived_at: stored.decision.createdAt },
      termination: { id: stored.termination.id, project_id: f.project.id, mapping_id: mapping.id,
        decision_id: stored.decision.id, stopped_sync_intent_ids: [] },
      decision: { id: stored.decision.id, project_id: f.project.id, decision_type: "sync_mapping_termination",
        summary: "Provider no longer used", actor_id: "acceptance-user", created_at: stored.decision.createdAt }
    } });
    const duplicate = await client.callTool({ name: "terminate_sync_mapping", arguments: command });
    expect(JSON.parse((duplicate.content as { text: string }[])[0]!.text)).toMatchObject({ ok: false,
      error: { code: "CONFLICT", details: { termination_id: stored.termination.id } } });
    const missing = await client.callTool({ name: "terminate_sync_mapping", arguments: { ...command, mapping_id: "missing" } });
    expect(JSON.parse((missing.content as { text: string }[])[0]!.text)).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(f.ports.auditLog.list()).toHaveLength(beforeAudit.length + 1);
  } finally { await client.close(); await server.close(); f.database.close(); }
});
