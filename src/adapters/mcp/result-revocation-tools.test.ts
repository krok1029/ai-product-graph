import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createMcpServer } from "./server.js";

async function setup(targetCount = 1) {
  const fixture = acceptanceFixture(targetCount);
  const result = fixture.submit();
  fixture.service.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept" });
  const acceptance = fixture.ports.resultAcceptances.findByResultId(result.implementationResult.id)!;
  const server = createMcpServer(fixture.service);
  const client = new Client({ name: "revocation-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { ...fixture, result, acceptance, client, server,
    command: { result_acceptance_id: acceptance.id, idempotency_key: "revoke",
      reason: " Evidence was invalid at acceptance. ", ...(targetCount === 1 ? { next_delivery_status: "blocked" } : {}) },
    async close() { await client.close(); await server.close(); fixture.database.close(); }
  };
}

it("revokes and replays exact canonical data and original audit through MCP", async () => {
  const f = await setup();
  try {
    const response = await f.client.callTool({ name: "revoke_result_acceptance", arguments: f.command });

    expect(response.isError).not.toBe(true);
    const envelope = response.structuredContent as { ok: boolean; data: Record<string, unknown>; audit_log_id: string };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.ticket).toEqual({ id: f.ticket.id, delivery_status: "blocked" });
    expect(envelope.data.decision).toMatchObject({ project_id: f.project.id, actor_id: "acceptance-user",
      summary: f.command.reason.trim(), decision_type: "result_acceptance_revocation" });
    expect(envelope.data.result_revocation).toMatchObject({ result_acceptance_id: f.acceptance.id,
      previous_delivery_status: "done", resulting_delivery_status: "blocked" });
    expect(envelope.data.implementation_result).toEqual({ id: f.result.implementationResult.id,
      review_status: "approved", lifecycle_status: "archived" });
    f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);
    expect(await f.client.callTool({ name: "revoke_result_acceptance", arguments: f.command })).toEqual(response);
    const receipt = f.ports.operationReceipts.find(f.project.id, "acceptance-user", "revoke_result_acceptance", "revoke")!;
    expect(JSON.parse(receipt.responseJson)).toEqual(envelope.data);
    expect(receipt.responseAuditLogId).toBe(envelope.audit_log_id);
    expect(envelope.data).not.toHaveProperty("replayed");
    expect(envelope.data).not.toHaveProperty("receipt_id");
    const conflict = await f.client.callTool({ name: "revoke_result_acceptance", arguments: { ...f.command, reason: "Changed" } });
    expect(JSON.parse((conflict.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  } finally { await f.close(); }
});

it("uses closed MCP input and rejects forged identities, invalid statuses and blank commands", async () => {
  const f = await setup();
  try {
    for (const field of ["project_id", "actor_id", "created_at", "decision_id", "implementation_result_id",
      "previous_delivery_status", "resulting_delivery_status"]) {
      const rejected = await f.client.callTool({ name: "revoke_result_acceptance", arguments: { ...f.command, [field]: "forged" } });
      expect(rejected.isError).toBe(true);
    }
    for (const overrides of [{ reason: " " }, { idempotency_key: " " }, { next_delivery_status: "done" },
      { next_delivery_status: "planned" }, { next_delivery_status: null }]) {
      const rejected = await f.client.callTool({ name: "revoke_result_acceptance", arguments: { ...f.command, ...overrides } });
      expect(rejected.isError).toBe(true);
    }
    const missing = await f.client.callTool({ name: "revoke_result_acceptance", arguments: { ...f.command, result_acceptance_id: "missing" } });
    expect(JSON.parse((missing.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(f.ports.resultRevocations.findByAcceptanceId(f.acceptance.id)).toBeNull();
    expect(f.ports.operationReceipts.find(f.project.id, "acceptance-user", "revoke_result_acceptance", "revoke")).toBeNull();
    expect((await f.client.callTool({ name: "revoke_result_acceptance", arguments: f.command })).isError).not.toBe(true);
  } finally { await f.close(); }
});

it("requires unfinished multi-target MCP callers to omit next_delivery_status", async () => {
  const f = await setup(2);
  try {
    const rejected = await f.client.callTool({ name: "revoke_result_acceptance", arguments: { ...f.command, next_delivery_status: "blocked" } });
    expect(JSON.parse((rejected.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const response = await f.client.callTool({ name: "revoke_result_acceptance", arguments: f.command });

    expect(response.structuredContent).toMatchObject({ ok: true, data: {
      ticket: { id: f.ticket.id, delivery_status: "planned" },
      result_revocation: { previous_delivery_status: "planned", resulting_delivery_status: "planned" }
    } });
    expect(await f.client.callTool({ name: "revoke_result_acceptance", arguments: f.command })).toEqual(response);
  } finally { await f.close(); }
});
