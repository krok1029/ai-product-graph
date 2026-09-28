import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { planeObservationHistoryFixture } from "../../test-support/plane-observation-history-fixture.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";

it("reads archived observation/drift history consistently through strict tool/resource across real stdio restart without writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apg-observation-read-"));
  const databasePath = join(directory, "project.sqlite");
  const f = await planeObservationHistoryFixture();
  let client: Client | undefined;
  try {
    const empty = await f.exportMapping("empty");
    const first = f.capture({ id: "first" });
    const revision = f.replaceRevision();
    const second = f.capture({ id: "second", revisionId: revision.id, changes: [] });
    f.service.terminateSyncMapping({ mappingId: f.mapping.id, reason: "Keep captured history" });
    await f.database.backup(databasePath);
    const before = snapshot(databasePath);
    client = await connect(databasePath);

    const response = await tool(client, f.mapping.id);
    const uri = `product-graph://external-work-item-mappings/${f.mapping.id}/content-drifts`;
    const resourceResponse = await resource(client, uri);

    expect(response).toMatchObject({ ok: true, data: { mapping: { id: f.mapping.id, lifecycle_status: "archived" },
      observations: [{ snapshot: { id: "first", content: first.snapshot.content }, provenance: {
        snapshot_id: "first", project_id: f.project.id, mapping_id: f.mapping.id, external_work_item_id: f.mapping.externalWorkItemId,
        ticket_id: f.ticket.id, source_ticket_revision_id: f.revision.id, actor_id: first.provenance.actorId,
        audit_log_id: first.provenance.auditLogId } },
      { snapshot: { id: "second", content: second.snapshot.content }, provenance: { source_ticket_revision_id: revision.id } }],
      drifts: [{ id: "first-drift", snapshot_id: "first", diff: first.drift!.diff, resolution_decision_id: null }] } });
    expect(resourceResponse).toEqual(response.data);
    expect(response).not.toHaveProperty("audit_log_id");
    expect(response.data.drifts[0]).not.toHaveProperty("resolution_state");
    expect(await tool(client, empty.mapping.id)).toMatchObject({ ok: true, data: { observations: [], drifts: [] } });
    expect(await tool(client, "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    for (const args of [{ mapping_id: f.mapping.id, project_id: f.project.id }, { mapping_id: " " }, { mapping_id: 2 }]) {
      expect((await client.callTool({ name: "get_mapping_content_drift_history", arguments: args })).isError).toBe(true);
    }
    const firstText = JSON.stringify(response);
    await client.close();
    client = await connect(databasePath);

    expect(JSON.stringify(await tool(client, f.mapping.id))).toBe(firstText);
    expect(await resource(client, uri)).toEqual(resourceResponse);
    await client.close();
    client = undefined;
    expect(snapshot(databasePath)).toEqual(before);
  } finally { await client?.close(); f.database.close(); rmSync(directory, { recursive: true, force: true }); }
}, 25_000);

it("returns CONFLICT through both MCP surfaces for a known cross-project audit association", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apg-observation-corrupt-"));
  const databasePath = join(directory, "project.sqlite");
  const f = await planeObservationHistoryFixture();
  let client: Client | undefined;
  try {
    const captured = f.capture();
    const other = f.service.createProject({ name: "Other" }).project;
    f.database.prepare("UPDATE audit_log SET project_id = ? WHERE id = ?").run(other.id, captured.provenance.auditLogId);
    await f.database.backup(databasePath);
    const before = snapshot(databasePath);
    client = await connect(databasePath);

    expect(await tool(client, f.mapping.id)).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(resource(client, `product-graph://external-work-item-mappings/${f.mapping.id}/content-drifts`))
      .rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await client.close(); client = undefined;
    expect(snapshot(databasePath)).toEqual(before);
  } finally { await client?.close(); f.database.close(); rmSync(directory, { recursive: true, force: true }); }
}, 25_000);

async function connect(databasePath: string) {
  const target = new Client({ name: "plane-observation-history-tests", version: "1" });
  await target.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("src/index.ts")],
    env: { AI_PRODUCT_GRAPH_MCP_PROFILE: "full", ...getDefaultEnvironment(), AI_PRODUCT_GRAPH_DB_PATH: databasePath }, stderr: "pipe" }));
  return target;
}
async function tool(client: Client, mappingId: string) {
  const result = await client.callTool({ name: "get_mapping_content_drift_history", arguments: { mapping_id: mappingId } });
  return JSON.parse((result.content as { text: string }[])[0]!.text);
}
async function resource(client: Client, uri: string) {
  const result = await client.readResource({ uri });
  return JSON.parse(String(result.contents[0]!.text));
}
function snapshot(path: string) {
  const database = openDatabase(path);
  try { return { data: domainSnapshot(database), audit: database.prepare("SELECT * FROM audit_log ORDER BY rowid").all(),
    actors: database.prepare("SELECT * FROM local_actors ORDER BY rowid").all() }; }
  finally { database.close(); }
}
