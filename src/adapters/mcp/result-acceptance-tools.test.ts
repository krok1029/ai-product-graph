import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createMcpServer } from "./server.js";

it("accepts and replays exact canonical data/audit through MCP, rejecting injected actor and waiver fields", async () => {
  const fixture = acceptanceFixture();
  const result = fixture.submit(0, [0]);
  const server = createMcpServer(fixture.service);
  const client = new Client({ name: "acceptance-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const command = { implementation_result_id: result.implementationResult.id, idempotency_key: "accept",
      waivers: [{ acceptance_criterion_id: fixture.revision.specification.acceptance_criteria[0]!.id, reason: " Exception " }] };
    for (const field of ["project_id", "actor_id", "accepted_at", "approved_by", "approved_by_actor_id", "approved_at"]) {
      const rejected = await client.callTool({ name: "accept_implementation_result", arguments: { ...command, [field]: "forged" } });
      expect(rejected.isError).toBe(true);
    }
    for (const field of ["project_id", "decision_type", "decision_id", "actor_id", "created_at"]) {
      const rejected = await client.callTool({ name: "accept_implementation_result", arguments: {
        ...command, waivers: [{ ...command.waivers[0], [field]: "forged" }]
      } });
      expect(rejected.isError).toBe(true);
    }
    const response = await client.callTool({ name: "accept_implementation_result", arguments: command });
    expect(response.isError).not.toBe(true);
    const envelope = response.structuredContent as { ok: boolean; data: Record<string, unknown>; audit_log_id: string };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.result_acceptance).toEqual(expect.objectContaining({ actor_id: "acceptance-user", project_id: fixture.project.id }));
    expect(envelope.data.ticket).toEqual({ id: fixture.ticket.id, delivery_status: "done" });
    expect(envelope.data).not.toHaveProperty("replayed");
    expect(envelope.data).not.toHaveProperty("receipt_id");
    expect(envelope.data.implementation_result).not.toHaveProperty("approved_at");
    fixture.ports.implementationResults.archive(result.implementationResult.id, "later");
    expect(await client.callTool({ name: "accept_implementation_result", arguments: command })).toEqual(response);
    const receipt = fixture.ports.operationReceipts.find(fixture.project.id, "acceptance-user", "accept_implementation_result", "accept")!;
    expect(JSON.parse(receipt.responseJson)).toEqual(envelope.data);
    expect(receipt.responseAuditLogId).toBe(envelope.audit_log_id);
    expect(JSON.parse(receipt.responseJson)).not.toHaveProperty("ok");
  } finally {
    await client.close();
    await server.close();
    fixture.database.close();
  }
});
