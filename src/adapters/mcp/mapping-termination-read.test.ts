import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { mappingTerminationReadFixture } from "../../test-support/mapping-termination-read-fixture.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";

it("explains termination consistently through strict tool and resource across stdio restart without writes", async () => {
  // 前置：真實 command 停止含原始失敗紀錄的 mapping，另一個 mapping 保持 active。
  const directory = mkdtempSync(join(tmpdir(), "apg-termination-read-"));
  const databasePath = join(directory, "project.sqlite");
  const f = mappingTerminationReadFixture();
  let client: Client | undefined;
  try {
    const first = await f.exportMapping("first");
    const other = await f.exportMapping("other");
    const intent = f.mappedIntent(first.mapping, 1);
    f.attempt(first.mapping, intent, "failed");
    const stopped = f.service.terminateSyncMapping({ mappingId: first.mapping.id, reason: "Provider access retired" });
    await f.database.backup(databasePath);
    const before = snapshot(databasePath);
    client = await connect(databasePath);

    // 操作：查詢 public tool 與 resource，再重啟正式 stdio server。
    const response = await tool(client, first.mapping.id);
    expect(response).toMatchObject({ ok: true, data: { mapping_id: first.mapping.id, termination: {
      record: { id: stopped.termination.id, project_id: f.project.id, mapping_id: first.mapping.id,
        decision_id: stopped.decision.id, stopped_sync_intent_ids: [intent.id] },
      decision: { id: stopped.decision.id, project_id: f.project.id, decision_type: "sync_mapping_termination",
        summary: "Provider access retired", actor_id: stopped.decision.actorId, created_at: stopped.decision.createdAt },
      stopped_intents: [{ sync_intent: { id: intent.id, mapping_id: first.mapping.id }, request_state: "failed",
        attempts: [{ result_status: "failed", error: { code: "FAILED", detail: [null, "原文"] } }] }]
    } } });
    expect(response).not.toHaveProperty("audit_log_id");
    const uri = `product-graph://external-work-item-mappings/${first.mapping.id}/termination`;
    expect(await resource(client, uri)).toEqual(response.data);
    expect(await tool(client, other.mapping.id)).toMatchObject({ ok: true, data: { mapping_id: other.mapping.id, termination: null } });
    expect(await tool(client, "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    for (const args of [{ mapping_id: first.mapping.id, project_id: f.project.id }, { mapping_id: " " }]) {
      expect((await client.callTool({ name: "get_mapping_termination", arguments: args })).isError).toBe(true);
    }
    await client.close();
    client = await connect(databasePath);

    // 驗證：歷史 outcomes 完全一致，所有 durable tables、actor 與 audit 都不變。
    expect(await tool(client, first.mapping.id)).toEqual(response);
    expect(await resource(client, uri)).toEqual(response.data);
    await client.close();
    client = undefined;
    expect(snapshot(databasePath)).toEqual(before);
  } finally { await client?.close(); f.database.close(); rmSync(directory, { recursive: true, force: true }); }
}, 25_000);

async function connect(databasePath: string) {
  const target = new Client({ name: "mapping-termination-tests", version: "1" });
  await target.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("src/index.ts")],
    env: { ...getDefaultEnvironment(), AI_PRODUCT_GRAPH_DB_PATH: databasePath }, stderr: "pipe" }));
  return target;
}
async function tool(client: Client, mappingId: string) {
  const result = await client.callTool({ name: "get_mapping_termination", arguments: { mapping_id: mappingId } });
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
