// 以真實本機 SQLite 與可重現 fixtures 驗證處置契約，不呼叫真實 provider。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";
import { planeObservationHistoryFixture } from "../../test-support/plane-observation-history-fixture.js";
import { createMcpServer } from "./server.js";
import { serializeContentDriftResolution } from "./content-drift-resolution-serialization.js";
import { readContentDriftResolution } from "../../application/content-drift-resolution-support.js";

it("rejects through strict full MCP, returns shared resolution DTO and never invokes a provider", async () => {
  const f = await planeObservationHistoryFixture();
  const captured = f.capture();
  const server = createMcpServer(f.service, { profile: "full" });
  const client = new Client({ name: "rejection-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider call"));
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const command = { content_drift_id: ` ${captured.drift!.id} `, reason: "  保留本機規格  " };
    const before = f.allRows();
    for (const field of ["actor_id", "created_at", "project_id", "kind", "draft_ticket_revision_id", "decision_id", "idempotency_key"]) {
      expect((await client.callTool({ name: "reject_content_drift", arguments: { ...command, [field]: "injected" } })).isError).toBe(true);
    }
    for (const extra of [{ content_drift_id: "" }, { content_drift_id: " " }, { reason: "" }, { reason: " " }, { reason: null }]) {
      expect((await client.callTool({ name: "reject_content_drift", arguments: { ...command, ...extra } })).isError).toBe(true);
    }
    expect(f.allRows()).toEqual(before);
    const response = await client.callTool({ name: "reject_content_drift", arguments: command });
    const view = readContentDriftResolution(f.ports, captured.drift!.id);
    expect(response.structuredContent).toEqual({ ok: true, data: serializeContentDriftResolution(view), audit_log_id: view.resolution!.record.auditLogId });
    expect(response.structuredContent).toMatchObject({ data: { content_drift_id: captured.drift!.id,
      evidence: { mapping_id: f.mapping.id, ticket_id: f.ticket.id, snapshot_id: captured.snapshot.id,
        captured_source_ticket_revision_id: f.revision.id },
      resolution: { record: { kind: "reject", draft_ticket_revision_id: null }, decision: { summary: "保留本機規格", actor_id: "acceptance-user" }, draft: null } } });
    expect(JSON.parse(((await client.callTool({ name: "reject_content_drift", arguments: command })).content as { text: string }[])[0]!.text))
      .toMatchObject({ ok: false, error: { code: "CONFLICT", details: { resolution_id: view.resolution!.record.id } } });
    expect(JSON.parse(((await client.callTool({ name: "reject_content_drift", arguments: { ...command, content_drift_id: "missing" } })).content as { text: string }[])[0]!.text))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); await client.close(); await server.close(); f.database.close(); }
});

it.each(["core", "full"] as const)("exposes only the authorized %s profile surface", async profile => {
  const f = await planeObservationHistoryFixture();
  const before = f.allRows();
  const server = createMcpServer(f.service, { profile });
  const client = new Client({ name: "profile-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toHaveLength(profile === "core" ? 23 : 45);
    expect(names.includes("reject_content_drift")).toBe(profile === "full");
    expect(names.includes("adopt_content_drift")).toBe(profile === "full");
    expect(names).not.toContain("get_content_drift_resolution");
    const templates = (await client.listResourceTemplates()).resourceTemplates.map(resource => resource.uriTemplate);
    expect(templates).not.toContain("product-graph://content-drifts/{contentDriftId}/resolution");
    expect(f.allRows()).toEqual(before);
  } finally { await client.close(); await server.close(); f.database.close(); }
});
