import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { mappingTerminationReadFixture } from "../../test-support/mapping-termination-read-fixture.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";

it("observes the same ordered plan through strict tool and resource across real stdio restart without writes", async () => {
  // 前置：保存一個未開始的 intent，另一個 mapping 已由真正的 command 終止。
  const directory = mkdtempSync(join(tmpdir(), "apg-sync-plan-"));
  const databasePath = join(directory, "project.sqlite");
  const f = mappingTerminationReadFixture();
  let client: Client | undefined;
  try {
    const first = await f.exportMapping("first");
    const intent = f.mappedIntent(first.mapping, 1);
    const other = await f.exportMapping("other");
    const stopped = f.service.terminateSyncMapping({ mappingId: other.mapping.id, reason: "Retired" });
    await f.database.backup(databasePath);
    const before = snapshot(databasePath);
    client = await connect(databasePath);

    // 操作：正式 server 的 tool 與 resource 讀取同一個計畫。
    const response = await tool(client, first.mapping.id);
    const uri = `product-graph://external-work-item-mappings/${first.mapping.id}/sync-plan`;

    // 驗證：public DTO 僅提供觀測，不包含 claim；重啟也不改寫任何資料。
    const identity = { id: intent.id, sequence_number: 1, operation: "update", source_ticket_revision_id: f.revision.id };
    expect(response).toEqual({ ok: true, data: { mapping_id: first.mapping.id, included: true, state: "ready",
      next_intent: identity, blocking_intent_ids: [], termination_id: null,
      reasons: [{ code: "next_ordered_intent", intent_id: intent.id }], entries: [
        { id: first.create.id, sequence_number: null, operation: "create", source_ticket_revision_id: f.revision.id,
          disposition: "fulfilled", attempt_state: "succeeded", request_state: "succeeded" },
        { ...identity, disposition: "required", attempt_state: "unstarted", request_state: "pending" }
      ] } });
    expect(await resource(client, uri)).toEqual(response.data);
    expect(await tool(client, other.mapping.id)).toMatchObject({ ok: true, data: { state: "inactive", next_intent: null,
      included: false, termination_id: stopped.termination.id } });
    expect(await tool(client, "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    for (const args of [{ mapping_id: first.mapping.id, claim: true }, { mapping_id: " " }]) {
      expect((await client.callTool({ name: "get_mapping_sync_plan", arguments: args })).isError).toBe(true);
    }
    expect((await client.listTools()).tools.find(value => value.name === "get_mapping_sync_plan")!.description)
      .toContain("not an execution claim");
    await client.close();
    client = await connect(databasePath);
    expect(await tool(client, first.mapping.id)).toEqual(response);
    expect(await resource(client, uri)).toEqual(response.data);
    await client.close();
    client = undefined;
    expect(snapshot(databasePath)).toEqual(before);
  } finally { await client?.close(); f.database.close(); rmSync(directory, { recursive: true, force: true }); }
}, 25_000);

async function connect(databasePath: string) {
  const target = new Client({ name: "mapping-sync-plan-tests", version: "1" });
  await target.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("src/index.ts")],
    env: { ...getDefaultEnvironment(), AI_PRODUCT_GRAPH_DB_PATH: databasePath }, stderr: "pipe" }));
  return target;
}
async function tool(client: Client, mappingId: string) {
  const result = await client.callTool({ name: "get_mapping_sync_plan", arguments: { mapping_id: mappingId } });
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
