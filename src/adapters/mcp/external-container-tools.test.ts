import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createMcpServer } from "./server.js";
import type { ToolEnvelope } from "./tool-envelope.js";

const actor = { id: "00000000000000000000000042", displayName: "Container User" };
const now = "2026-09-27T00:00:00.000Z";
const input = { provider: "plane", workspace_identity: "Workspace", container_identity: "Project" };
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(path = ":memory:") {
  const database = openDatabase(path);
  const ports = createSqlitePorts(database);
  const service = new ProductGraphService(ports, { actor, clock: () => new Date(now) });
  const target = createMcpServer(service);
  const client = new Client({ name: "container-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await target.connect(serverTransport);
  await client.connect(clientTransport);
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await client.close();
    await target.close();
    database.close();
  }
  cleanups.push(close);
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    return result;
  }
  async function success(name: string, args: Record<string, unknown>) {
    const result = await call(name, args);
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const envelope = JSON.parse(content[0]!.text) as ToolEnvelope;
    expect(envelope.ok).toBe(true);
    return envelope;
  }
  return { database, ports, service, client, call, success, close };
}

describe("External Container MCP registration", () => {
  it("registers normalized global identities once and preserves first display name on replay", async () => {
    const target = await setup();

    const created = await target.success("register_external_container", {
      ...input, workspace_identity: " Workspace ", container_identity: " Project ", display_name: " First Name "
    });
    const container = created.data!.external_container as { id: string };
    const replay = await target.success("register_external_container", { ...input, display_name: "New Name" });

    expect(created.data).toEqual({ created: true, external_container: {
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/), provider: "plane",
      workspace_identity: "Workspace", container_identity: "Project", display_name: "First Name",
      created_at: now, updated_at: now
    } });
    expect(replay.data).toEqual({ external_container: created.data!.external_container, created: false });
    expect(replay.audit_log_id).toBeUndefined();
    expect(target.ports.auditLog.list()).toEqual([expect.objectContaining({
      id: created.audit_log_id, projectId: null, actorId: actor.id, actorType: "mcp_client",
      action: "external_container.registered", entityType: "external_container", entityId: container.id, createdAt: now
    })]);
    expect(target.database.prepare("SELECT id, display_name, created_at, updated_at FROM local_actors").all()).toEqual([{
      id: actor.id, display_name: actor.displayName, created_at: now, updated_at: now
    }]);
    expect(target.database.prepare("SELECT metadata_json FROM external_containers").get()).toEqual({ metadata_json: "{}" });
    for (const table of ["projects", "sync_intents", "external_work_items", "external_work_item_mappings", "sync_attempts"]) {
      expect(target.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(target.database.pragma("foreign_key_check")).toEqual([]);
  });

  it("separates case-sensitive and workspace identities and lists by creation time then id", async () => {
    const target = await setup();
    expect((await target.success("list_external_containers", {})).data).toEqual({ external_containers: [] });
    const first = await target.success("register_external_container", input);
    const second = await target.success("register_external_container", { ...input, workspace_identity: "workspace" });
    const third = await target.success("register_external_container", { ...input, container_identity: "project" });
    const fourth = await target.success("register_external_container", { ...input, workspace_identity: "Other" });
    const containers = [first, second, third, fourth].map(entry => entry.data!.external_container as { id: string });
    // 固定相同建立時間，驗證同時間時以 id 排序，而非依 INSERT 順序。
    containers.sort((a, b) => a.id.localeCompare(b.id));
    const expected = { external_containers: containers };
    expect((await target.success("list_external_containers", {})).data).toEqual(expected);
    expect((await target.success("list_external_containers", { provider: "plane" })).data).toEqual(expected);
    expect(new Set(containers.map(container => container.id)).size).toBe(4);
    const id = containers[0]!.id;
    target.database.prepare("UPDATE external_containers SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .run(containers[3]!.id);
    const reordered = (await target.success("list_external_containers", {})).data!.external_containers as Array<{ id: string }>;
    expect(reordered.map(container => container.id)).toEqual([containers[3]!.id, id, containers[1]!.id, containers[2]!.id]);
  });

  it.each([
    { provider: "github" }, { provider: "Plane" }, { provider: " plane " },
    { workspace_identity: " \t" }, { container_identity: "" }, { container_identity: null },
    { display_name: " " }, { display_name: null }, { credentials: "secret" },
    { metadata: {} }, { project_id: "unexpected" }
  ])("rejects invalid closed registration input without side effects: %j", async extra => {
    const target = await setup();

    const result = await target.call("register_external_container", { ...input, ...extra });

    expect(result.isError).toBe(true);
    expect(target.ports.externalContainers.list()).toEqual([]);
    expect(target.ports.auditLog.list()).toEqual([]);
    expect(target.database.prepare("SELECT COUNT(*) AS count FROM local_actors").get()).toEqual({ count: 0 });
  });

  it.each([{ provider: "github" }, { provider: null }, { project_id: "unexpected" }])(
    "rejects invalid list filters: %j", async args => {
      const target = await setup();
      expect((await target.call("list_external_containers", args)).isError).toBe(true);
      expect(target.ports.auditLog.list()).toEqual([]);
    }
  );

  it("rolls back container and first-use actor when the audit insert fails", async () => {
    const target = await setup();
    target.database.exec(`CREATE TRIGGER fail_container_audit BEFORE INSERT ON audit_log
      WHEN NEW.entity_type = 'external_container' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);

    expect((await target.call("register_external_container", input)).isError).toBe(true);

    expect(target.ports.externalContainers.list()).toEqual([]);
    expect(target.ports.auditLog.list()).toEqual([]);
    expect(target.database.prepare("SELECT COUNT(*) AS count FROM local_actors").get()).toEqual({ count: 0 });
    target.database.exec("DROP TRIGGER fail_container_audit");
    expect((await target.success("register_external_container", input)).data!.created).toBe(true);
    expect(target.ports.auditLog.list()).toHaveLength(1);
  });

  it("restores identity after SQLite reopen and exposes exact identity lookups to later workflows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "apg-container-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "graph.sqlite");
    const first = await setup(path);
    const created = await first.success("register_external_container", input);
    await first.close();
    const target = await setup(path);

    const replay = await target.success("register_external_container", input);

    expect(replay.data).toEqual({ created: false, external_container: created.data!.external_container });
    expect((await target.success("list_external_containers", {})).data)
      .toEqual({ external_containers: [created.data!.external_container] });
    const container = target.ports.externalContainers.findByIdentity({
      provider: "plane", workspaceIdentity: "Workspace", containerIdentity: "Project"
    });
    expect(container).toMatchObject({ displayName: null, createdAt: now, updatedAt: now });
    expect(target.ports.externalContainers.findById(container!.id)).toEqual(container);
    expect(target.ports.externalContainers.findById("missing")).toBeNull();
    expect(target.ports.externalContainers.findByIdentity({
      provider: "plane", workspaceIdentity: "missing", containerIdentity: "Project"
    })).toBeNull();
    expect(target.ports.auditLog.list()).toHaveLength(1);
  });
});
