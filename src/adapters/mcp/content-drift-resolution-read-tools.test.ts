// 公開查詢契約以 stdio 重開資料庫驗證，並比對單筆與 history 的共同 DTO。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { planeObservationHistoryFixture } from "../../test-support/plane-observation-history-fixture.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createMcpServer } from "./server.js";
import { serializeContentDriftResolution } from "./content-drift-resolution-serialization.js";

it("returns strict read-only DTOs and refuses unknown overrides without invoking providers", async () => {
  const f = await planeObservationHistoryFixture();
  const captured = f.capture();
  const server = createMcpServer(f.service, { profile: "full" });
  const target = new Client({ name: "resolution-read-tests", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider call"));
  await server.connect(serverTransport); await target.connect(clientTransport);
  try {
    const before = f.allRows();
    const result = await tool(target, ` ${captured.drift!.id} `);

    expect(result).toEqual({ ok: true, data: serializeContentDriftResolution(f.service.getContentDriftResolution(captured.drift!.id)) });
    expect(result.data.resolution).toBeNull();
    expect(await resource(target, driftUri(captured.drift!.id))).toEqual(result.data);
    expect(await tool(target, "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(resource(target, driftUri("missing"))).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    for (const arguments_ of [{ content_drift_id: "" }, { content_drift_id: " " }, { content_drift_id: 2 },
      { content_drift_id: captured.drift!.id, actor_id: "override" },
      { content_drift_id: captured.drift!.id, project_id: f.project.id },
      { content_drift_id: captured.drift!.id, decision_id: "override" }]) {
      expect((await target.callTool({ name: "get_content_drift_resolution", arguments: arguments_ })).isError).toBe(true);
    }
    expect(f.allRows()).toEqual(before);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); await target.close(); await server.close(); f.database.close(); }
});

it("preserves resolution and history serialization across stdio restart without database writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apg-resolution-read-"));
  const databasePath = join(directory, "project.sqlite");
  const f = await planeObservationHistoryFixture();
  let target: Client | undefined;
  try {
    const captured = f.capture();
    const rejected = f.service.rejectContentDrift({ contentDriftId: captured.drift!.id, reason: "外部尚未同步，保留本機內容" });
    f.replaceRevision();
    f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "保留歷史" });
    await f.database.backup(databasePath);
    const before = snapshot(databasePath);
    target = await connect(databasePath);

    const result = await tool(target, captured.drift!.id);
    const history = await target.callTool({ name: "get_mapping_content_drift_history", arguments: { mapping_id: f.mapping.id } });
    const historyData = JSON.parse((history.content as { text: string }[])[0]!.text).data;

    expect(result).toMatchObject({ ok: true, data: { content_drift_id: captured.drift!.id,
      evidence: { captured_source_ticket_revision_id: f.revision.id }, resolution: {
        record: { kind: "reject", draft_ticket_revision_id: null }, draft: null,
        decision: { id: rejected.resolution.decision.id, summary: "外部尚未同步，保留本機內容",
          actor_id: rejected.resolution.decision.actorId, created_at: rejected.resolution.decision.createdAt }
      } } });
    expect(result).not.toHaveProperty("audit_log_id");
    expect(historyData.drifts[0].resolution).toEqual(result.data.resolution);
    expect(historyData.drifts[0].resolution_decision_id).toBe(rejected.resolution.decision.id);
    expect(await resource(target, driftUri(captured.drift!.id))).toEqual(result.data);
    expect(await resource(target, `product-graph://external-work-item-mappings/${f.mapping.id}/content-drifts`)).toEqual(historyData);
    await target.close(); target = await connect(databasePath);

    expect(await tool(target, captured.drift!.id)).toEqual(result);
    expect(await resource(target, driftUri(captured.drift!.id))).toEqual(result.data);
    await target.close(); target = undefined;
    expect(snapshot(databasePath)).toEqual(before);
  } finally { await target?.close(); f.database.close(); rmSync(directory, { recursive: true, force: true }); }
}, 25_000);

it("fails closed on both tool and resource for an unsupported legacy pointer", async () => {
  const f = await planeObservationHistoryFixture();
  const captured = f.capture();
  const termination = f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "不屬於 drift 的決策" });
  f.database.exec("DROP TRIGGER content_drift_resolution_reference_immutable");
  f.database.prepare("UPDATE content_drifts SET resolution_decision_id = ?").run(termination.decision.id);
  const before = f.allRows();
  const server = createMcpServer(f.service, { profile: "full" });
  const target = new Client({ name: "resolution-corruption-tests", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await target.connect(clientTransport);
  try {
    expect(await tool(target, captured.drift!.id)).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(resource(target, driftUri(captured.drift!.id))).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect(f.allRows()).toEqual(before);
  } finally { await target.close(); await server.close(); f.database.close(); }
});

async function connect(databasePath: string) {
  const target = new Client({ name: "resolution-read-restart-tests", version: "1" });
  await target.connect(new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", resolve("src/index.ts")], env: { ...getDefaultEnvironment(),
      AI_PRODUCT_GRAPH_MCP_PROFILE: "full", AI_PRODUCT_GRAPH_DB_PATH: databasePath }, stderr: "pipe" }));
  return target;
}
async function tool(target: Client, id: string) {
  const response = await target.callTool({ name: "get_content_drift_resolution", arguments: { content_drift_id: id } });
  return JSON.parse((response.content as { text: string }[])[0]!.text);
}
async function resource(target: Client, uri: string) {
  const response = await target.readResource({ uri });
  return JSON.parse(String(response.contents[0]!.text));
}
function driftUri(id: string) { return `product-graph://content-drifts/${id}/resolution`; }
function snapshot(path: string) {
  const database = openDatabase(path);
  try {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    return Object.fromEntries(tables.map(({ name }) => [name, database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]));
  } finally { database.close(); }
}
