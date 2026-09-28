import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { domainSnapshot } from "../../test-support/domain-snapshot.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createFullMcpServer as createMcpServer } from "../../test-support/full-mcp-server.js";

const eventTime = "2026-09-29T12:00:00.000Z";
async function setup() {
  const f = acceptanceFixture();
  let clockCalls = 0;
  const service = new ProductGraphService(f.ports, { actor: { id: "handoff-user", displayName: "Handoff reader" },
    clock: () => { clockCalls++; return new Date(eventTime); } });
  const server = createMcpServer(service);
  const client = new Client({ name: "handoff-audit-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { ...f, client, clockCalls: () => clockCalls,
    command: { implementation_brief_id: f.briefs[0]!.id,
      current_repository_state: { commit_sha: "abc123", dirty_state_fingerprint: null as string | null } },
    audits: () => f.ports.auditLog.list().filter(entry => entry.action.startsWith("implementation_handoff.")),
    async close() { await client.close(); await server.close(); f.database.close(); }
  };
}

it("records each successful attempt with the first configured actor and a single server event time", async () => {
  const f = await setup();
  try {
    const before = domainSnapshot(f.database);

    const response = await f.client.callTool({ name: "get_implementation_handoff", arguments: f.command });

    expect(response.structuredContent).toMatchObject({ ok: true, data: { freshness: "current" } });
    expect(f.audits()).toHaveLength(1);
    expect(f.audits()[0]).toMatchObject({ projectId: f.project.id, entityId: f.briefs[0]!.id,
      entityType: "implementation_brief", actorType: "mcp_client", actorId: "handoff-user",
      action: "implementation_handoff.succeeded", createdAt: eventTime,
      beforeSummary: null, afterSummary: { freshness: "current" }, metadata: {} });
    expect(f.clockCalls()).toBe(1);
    expect(f.database.prepare("SELECT * FROM local_actors WHERE id = ?").get("handoff-user"))
      .toMatchObject({ display_name: "Handoff reader", created_at: eventTime, updated_at: eventTime });
    expect(domainSnapshot(f.database)).toEqual(before);
    await f.client.callTool({ name: "get_implementation_handoff", arguments: f.command });
    expect(f.audits()).toHaveLength(2);
    expect(new Set(f.audits().map(entry => entry.id)).size).toBe(2);
    expect(f.clockCalls()).toBe(2);
    expect(domainSnapshot(f.database)).toEqual(before);
  } finally { await f.close(); }
});

it("commits stale observations before returning the unchanged error without storing raw repository state", async () => {
  const f = await setup();
  const directory = mkdtempSync(join(tmpdir(), "handoff-history-"));
  try {
    const before = domainSnapshot(f.database);
    f.command.current_repository_state.dirty_state_fingerprint = "private-client-fingerprint";

    const response = await f.client.callTool({ name: "get_implementation_handoff", arguments: f.command });

    expect(response.isError).toBe(true);
    const envelope = JSON.parse((response.content as { text: string }[])[0]!.text);
    expect(envelope).toMatchObject({ ok: false, error: { code: "STALE_HANDOFF", details: {
      reason: "repository_dirty_state_mismatch", currentDirtyStateFingerprint: "private-client-fingerprint"
    } } });
    expect(envelope).not.toHaveProperty("data");
    expect(f.audits()).toHaveLength(1);
    expect(f.audits()[0]).toMatchObject({ actorId: "handoff-user", createdAt: eventTime,
      afterSummary: { freshness: "stale", reason: "repository_dirty_state_mismatch",
        repositoryContextSnapshotId: f.briefs[0]!.repositoryContextSnapshotId } });
    expect(JSON.stringify(f.audits())).not.toContain("private-client-fingerprint");
    expect(f.clockCalls()).toBe(1);
    expect(domainSnapshot(f.database)).toEqual(before);
    const path = join(directory, "history.sqlite");
    await f.database.backup(path);
    const reopened = openDatabase(path);
    try {
      expect(createSqlitePorts(reopened).auditLog.list()).toEqual(f.ports.auditLog.list());
      expect(domainSnapshot(reopened)).toEqual(before);
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally { reopened.close(); }
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }); }
});

it.each([false, true])("returns STORAGE_ERROR and rolls back actor/audit writes when audit fails (stale: %s)", async stale => {
  const f = await setup();
  try {
    const before = domainSnapshot(f.database);
    const auditBefore = f.ports.auditLog.list();
    const actorsBefore = f.database.prepare("SELECT * FROM local_actors").all();
    f.database.exec(`CREATE TRIGGER fail_handoff_audit BEFORE INSERT ON audit_log
      WHEN NEW.action LIKE 'implementation_handoff.%'
      BEGIN SELECT RAISE(ABORT, 'forced handoff audit failure'); END;`);
    if (stale) f.command.current_repository_state.commit_sha = "different";

    const response = await f.client.callTool({ name: "get_implementation_handoff", arguments: f.command });

    expect(response.isError).toBe(true);
    expect(JSON.parse((response.content as { text: string }[])[0]!.text))
      .toMatchObject({ ok: false, error: { code: "STORAGE_ERROR" } });
    expect(response).not.toHaveProperty("structuredContent");
    expect(f.ports.auditLog.list()).toEqual(auditBefore);
    expect(f.database.prepare("SELECT * FROM local_actors").all()).toEqual(actorsBefore);
    expect(domainSnapshot(f.database)).toEqual(before);
    expect(f.database.pragma("foreign_key_check")).toEqual([]);
  } finally { await f.close(); }
});

it("does not record unknown Briefs or convert genuine SQLite read failures into stale events", async () => {
  const f = await setup();
  try {
    const before = domainSnapshot(f.database);
    const actorsBefore = f.database.prepare("SELECT * FROM local_actors").all();
    const auditBefore = f.ports.auditLog.list();

    const unknown = await f.client.callTool({ name: "get_implementation_handoff",
      arguments: { ...f.command, implementation_brief_id: "unknown" } });

    expect(JSON.parse((unknown.content as { text: string }[])[0]!.text))
      .toMatchObject({ error: { code: "NOT_FOUND", details: { implementationBriefId: "unknown" } } });
    expect(f.clockCalls()).toBe(0);
    f.ports.repositoryContextSnapshots.findById = () => {
      f.database.prepare("SELECT * FROM deliberately_missing_table").get();
      return null;
    };

    const failed = await f.client.callTool({ name: "get_implementation_handoff", arguments: f.command });

    expect(JSON.parse((failed.content as { text: string }[])[0]!.text))
      .toMatchObject({ error: { code: "STORAGE_ERROR", details: { sqlite_code: "SQLITE_ERROR" } } });
    expect(f.ports.auditLog.list()).toEqual(auditBefore);
    expect(f.database.prepare("SELECT * FROM local_actors").all()).toEqual(actorsBefore);
    expect(domainSnapshot(f.database)).toEqual(before);
  } finally { await f.close(); }
});
