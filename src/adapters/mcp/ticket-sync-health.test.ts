import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";

it("agrees across the Ticket health tool and resources after stdio restart without writes", async () => {
  // 前置：由真實 application 保存未執行的 manual export，交由正式 stdio entrypoint 讀取。
  const directory = mkdtempSync(join(tmpdir(), "apg-ticket-health-"));
  const databasePath = join(directory, "project.sqlite");
  const f = acceptanceFixture();
  let client: Client | undefined;
  try {
    const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
    const intent = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
      externalContainerId: container.id, idempotencyKey: "health" }).syncIntent;
    await f.database.backup(databasePath);
    const before = snapshot(databasePath);
    client = await connect(databasePath);

    // 操作：同時讀取 health tool、完整 resource 及既有 Ticket/context 摘要。
    const first = await tool(client, f.ticket.id);
    expect(first).toMatchObject({ ok: true, data: { ticket_id: f.ticket.id, sync_health: "pending",
      active_mapping_count: 0, outstanding_export_count: 1,
      outstanding_exports: [{ sync_intent_id: intent.id, sync_health: "pending", request_state: "pending" }] } });
    expect(await resource(client, `product-graph://tickets/${f.ticket.id}/sync-health`)).toEqual(first.data);
    expect(await resource(client, `product-graph://tickets/${f.ticket.id}`)).toMatchObject({ sync_health: "pending" });
    expect(await resource(client, `product-graph://tickets/${f.ticket.id}/context`)).toMatchObject({ sync_health: "pending" });
    expect((await client.callTool({ name: "get_ticket_sync_health", arguments: { ticket_id: f.ticket.id, sync_health: "current" } })).isError).toBe(true);
    expect(await tool(client, "missing-ticket")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await client.close();
    client = await connect(databasePath);

    // 驗證：重啟後相同觀測值，所有 durable state（含 audit）完全不變。
    expect(await tool(client, f.ticket.id)).toEqual(first);
    expect(await resource(client, `product-graph://tickets/${f.ticket.id}/sync-health`)).toEqual(first.data);
    await client.close();
    client = undefined;
    expect(snapshot(databasePath)).toEqual(before);
  } finally {
    await client?.close();
    f.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 25_000);

async function connect(databasePath: string) {
  const target = new Client({ name: "ticket-health-tests", version: "1" });
  await target.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("src/index.ts")],
    env: { ...getDefaultEnvironment(), AI_PRODUCT_GRAPH_DB_PATH: databasePath }, stderr: "pipe" }));
  return target;
}
async function tool(client: Client, ticketId: string) {
  const result = await client.callTool({ name: "get_ticket_sync_health", arguments: { ticket_id: ticketId } });
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
