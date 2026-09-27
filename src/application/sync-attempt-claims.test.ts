import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { openDatabase, type SqliteDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { SyncAttemptClaims } from "./sync-attempt-claims.js";
import type { ApplicationPorts } from "./ports.js";
import type { SyncIntent } from "../domain/sync-intent.js";

let fixture: ReturnType<typeof acceptanceFixture>;
let ports: ApplicationPorts;
let intent: SyncIntent;
let claims: SyncAttemptClaims;
let milliseconds: number;
let serial: number;
const paths: string[] = [];
const opened: SqliteDatabase[] = [];
const children: ChildProcess[] = [];
const now = () => new Date(milliseconds).toISOString();
const next = () => `claim-test-${++serial}`;
function workflow(target = ports) {
  return new SyncAttemptClaims(target.syncClaims, { clock: () => new Date(milliseconds), idFactory: next, tokenFactory: next });
}
function counts() {
  return ["sync_intent_claims", "sync_attempts", "audit_log"].map(table =>
    (fixture.database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
}
function fence(token: string) { return { intentId: intent.id, token, now: now(), auditId: next() }; }
function persistSuccessArtifacts(database = fixture.database) {
  database.prepare(`INSERT INTO external_work_items
    (id,external_container_id,provider,external_id,lifecycle_status,created_at,updated_at)
    VALUES ('external-item',?,'plane','provider-id','active',?,?)`).run(intent.externalContainerId, now(), now());
  database.prepare(`INSERT INTO external_work_item_mappings
    (id,project_id,internal_owner_type,internal_owner_id,external_container_id,external_work_item_id,
     source_ticket_revision_id,lifecycle_status,created_at,updated_at)
    VALUES ('mapping',?,'ticket',?,?,'external-item',?,'active',?,?)`).run(
      intent.projectId, fixture.ticket.id, intent.externalContainerId, intent.sourceTicketRevisionId, now(), now());
  database.prepare(`INSERT INTO external_work_item_snapshots
    (id,project_id,external_work_item_id,mapping_id,content_json,captured_at)
    VALUES ('snapshot',?,'external-item','mapping','{}',?)`).run(intent.projectId, now());
}

beforeEach(() => {
  fixture = acceptanceFixture(); ports = fixture.ports;
  const container = fixture.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project" }).externalContainer;
  intent = fixture.service.requestPlaneTicketExport({ ticketId: fixture.ticket.id, sourceTicketRevisionId: fixture.revision.id,
    externalContainerId: container.id, idempotencyKey: "manual" }).syncIntent;
  milliseconds = Date.UTC(2026, 8, 28); serial = 0; claims = workflow();
});
afterEach(() => {
  children.splice(0).forEach(child => child.kill());
  opened.splice(0).forEach(database => database.close());
  fixture.database.close(); paths.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }));
});

describe("durable Sync Attempt claim and fencing", () => {
  it("claims pinned immutable intent and atomically records server identity, stable key, lease and audit", () => {
    const before = JSON.stringify(ports.syncIntents.findById(intent.id));
    const result = claims.claim(intent.id, " worker-a ", 1000);
    expect(result.syncIntent).toEqual(intent);
    expect(result.claim).toMatchObject({ workerId: "worker-a", claimedAt: now(), expiresAt: "2026-09-28T00:00:01.000Z",
      invocationStarted: false, invocationKind: null, requiresReconciliation: false });
    expect(ports.syncIntents.listAttempts(intent.id)).toEqual([expect.objectContaining({
      id: result.claim.attemptId, operation: intent.operation, idempotencyKey: intent.idempotencyKey,
      startedAt: now(), resultStatus: "started", completedAt: null })]);
    expect(ports.auditLog.list().filter(entry => entry.action === "sync_attempt.claimed")).toEqual([
      expect.objectContaining({ entityId: result.claim.attemptId, createdAt: now(), actorType: "system" })]);
    expect(JSON.stringify(ports.syncIntents.findById(intent.id))).toBe(before);
    expect(fixture.database.pragma("foreign_key_check")).toEqual([]);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid lease %s without writes", duration => {
    const before = counts();
    expect(() => claims.claim(intent.id, "worker", duration)).toThrow("positive integer");
    expect(counts()).toEqual(before);
  });

  it("rejects unknown, archived, inapplicable and malformed intent without claims", () => {
    const before = counts();
    expect(() => claims.claim("missing", "worker", 100)).toThrow("not found");
    fixture.database.prepare("UPDATE sync_intents SET lifecycle_status = 'archived' WHERE id = ?").run(intent.id);
    expect(() => claims.claim(intent.id, "worker", 100)).toThrow("active Plane");
    fixture.database.prepare("UPDATE sync_intents SET lifecycle_status = 'active', operation = 'update' WHERE id = ?").run(intent.id);
    expect(() => claims.claim(intent.id, "worker", 100)).toThrow("active Plane");
    fixture.database.prepare("UPDATE sync_intents SET operation = 'create', payload_hash = 'wrong' WHERE id = ?").run(intent.id);
    expect(() => claims.claim(intent.id, "worker", 100)).toThrow("active Plane");
    expect(counts()).toEqual(before);
  });

  it("two real connections cannot claim the same live lease; exact expiry recovers and fences old worker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "apg-claims-")); paths.push(directory);
    const file = join(directory, "claims.sqlite"); await fixture.database.backup(file);
    const first = openDatabase(file), second = openDatabase(file); opened.push(first, second);
    const firstPorts = createSqlitePorts(first), secondPorts = createSqlitePorts(second);
    const old = workflow(firstPorts).claim(intent.id, "first", 1000).claim;
    expect(() => workflow(secondPorts).claim(intent.id, "second", 1000)).toThrow("already leased");
    milliseconds += 1000;
    const fresh = workflow(secondPorts).claim(intent.id, "second", 1000).claim;
    expect(fresh.requiresReconciliation).toBe(false);
    expect(firstPorts.syncIntents.listAttempts(intent.id)).toEqual([
      expect.objectContaining({ id: old.attemptId, resultStatus: "failed", error: {
        code: "INTERRUPTED", invocation_started: false, outcome_uncertain: false } }),
      expect.objectContaining({ id: fresh.attemptId, resultStatus: "started" })]);
    expect(() => workflow(firstPorts).markInvoking(intent.id, old.token)).toThrow("expired, released");
    expect(() => workflow(firstPorts).fail(intent.id, old.token, { code: "LATE" })).toThrow("expired, released");
    expect(secondPorts.syncClaims.assertCurrent(fence(fresh.token))).toEqual(fresh);
  });

  it("serializes simultaneous claims from independent worker processes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "apg-claim-race-")); paths.push(directory);
    const file = join(directory, "claims.sqlite"); await fixture.database.backup(file);
    const script = `
      import { openDatabase } from ${JSON.stringify(new URL("../infrastructure/sqlite/database.ts", import.meta.url).href)};
      import { createSqlitePorts } from ${JSON.stringify(new URL("../infrastructure/sqlite/repositories.ts", import.meta.url).href)};
      import { SyncAttemptClaims } from ${JSON.stringify(new URL("./sync-attempt-claims.ts", import.meta.url).href)};
      const db = openDatabase(${JSON.stringify(file)});
      const claims = new SyncAttemptClaims(createSqlitePorts(db).syncClaims, {clock: () => new Date(${milliseconds})});
      process.stdout.write("ready\\n");
      process.stdin.once("data", () => {
        try { claims.claim(${JSON.stringify(intent.id)}, String(process.pid), 1000); process.stdout.write("claimed\\n"); }
        catch (error) { process.stdout.write(error.code + "\\n"); }
        finally { db.close(); process.stdin.destroy(); }
      });`;
    const workers = Array.from({ length: 2 }, () => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
      children.push(child);
      let output = "", errors = "";
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout.on("data", data => { output += String(data); if (output.includes("ready")) resolve(); });
        child.on("error", reject);
        child.on("exit", code => { if (!output.includes("ready")) reject(new Error(`worker ${code}: ${errors}`)); });
      });
      child.stderr.on("data", data => { errors += String(data); });
      const done = new Promise<string>((resolve, reject) => {
        child.on("exit", code => code === 0 ? resolve(output) : reject(new Error(errors)));
        child.on("error", reject);
      });
      return { child, ready, done };
    });
    await Promise.all(workers.map(worker => worker.ready));
    workers.forEach(worker => worker.child.stdin.end("claim"));
    const results = await Promise.all(workers.map(worker => worker.done));
    expect(results.filter(result => result.includes("claimed"))).toHaveLength(1);
    expect(results.filter(result => result.includes("CONFLICT"))).toHaveLength(1);
    const database = openDatabase(file); opened.push(database);
    expect(createSqlitePorts(database).syncIntents.listAttempts(intent.id)).toHaveLength(1);
  });

  it("keeps legacy chronological ordering and uses claim sequence for fixed-clock retries", () => {
    for (const [id, time] of [["legacy-z", "2026-09-27T00:00:00.000Z"], ["legacy-a", now()], ["legacy-b", now()]]) {
      fixture.database.prepare(`INSERT INTO sync_attempts (id,sync_intent_id,operation,idempotency_key,started_at,
        completed_at,result_status,error_json) VALUES (?,?,'create',?,?,?,'failed','{}')`).run(id, intent.id, intent.idempotencyKey, time, time);
    }
    const first = claims.claim(intent.id, "first", 1000).claim;
    expect(first.requiresReconciliation).toBe(true);
    claims.fail(intent.id, first.token, { code: "UNAVAILABLE" });
    const second = claims.claim(intent.id, "second", 1000).claim;
    expect(ports.syncIntents.listAttempts(intent.id).map(attempt => attempt.id)).toEqual([
      "legacy-z", "legacy-a", "legacy-b", first.attemptId, second.attemptId]);
    expect(fixture.service.getSyncIntent(intent.id).requestState).toBe("running");
  });

  it("retains invocation uncertainty across expired claims and subsequent failures before invocation", () => {
    const first = claims.claim(intent.id, "first", 1000).claim;
    expect(claims.markInvoking(intent.id, first.token).invocationKind).toBe("create");
    milliseconds += 1000;
    const second = claims.claim(intent.id, "second", 1000).claim;
    expect(second.requiresReconciliation).toBe(true);
    claims.fail(intent.id, second.token, { code: "NETWORK_DISABLED", outcome_uncertain: false });
    const third = claims.claim(intent.id, "third", 1000).claim;
    expect(third.requiresReconciliation).toBe(true);
    expect(claims.markInvoking(intent.id, third.token).invocationKind).toBe("reconcile");
    expect(ports.syncIntents.listAttempts(intent.id)[0]!.error).toEqual({ code: "INTERRUPTED", invocation_started: true, outcome_uncertain: true });
    expect(() => claims.markInvoking(intent.id, third.token)).toThrow("already recorded");
  });

  it("only a fenced definitive reconciliation permits the next attempt to create", () => {
    const initial = claims.claim(intent.id, "first", 1000).claim;
    claims.markInvoking(intent.id, initial.token);
    expect(() => ports.transactions.run(() => ports.syncClaims.completeReconciledAbsent({ ...fence(initial.token), response: {} })))
      .toThrow("reconciliation invocation");
    claims.fail(intent.id, initial.token, { code: "TIMEOUT" });
    const recovery = claims.claim(intent.id, "recovery", 1000).claim;
    claims.markInvoking(intent.id, recovery.token);
    expect(() => ports.syncClaims.completeReconciledAbsent({ ...fence(recovery.token), response: {} })).toThrow("processor transaction");
    ports.transactions.run(() => ports.syncClaims.completeReconciledAbsent({ ...fence(recovery.token), response: { result: "definitely_absent" } }));
    const retry = claims.claim(intent.id, "retry", 1000).claim;
    expect(retry.requiresReconciliation).toBe(false);
    expect(fixture.service.getSyncIntent(intent.id).requestState).toBe("running");
    expect(claims.markInvoking(intent.id, retry.token).invocationKind).toBe("create");
    expect(ports.syncIntents.listAttempts(intent.id).find(attempt => attempt.id === recovery.attemptId)).toMatchObject({ resultStatus: "failed",
      error: { code: "RECONCILED_ABSENT", outcome_uncertain: false }, response: { result: "definitely_absent" } });
  });

  it("restores durable claim, invocation stage and uncertainty after reopening storage", async () => {
    const first = claims.claim(intent.id, "first", 1000).claim; claims.markInvoking(intent.id, first.token);
    const directory = mkdtempSync(join(tmpdir(), "apg-claims-")); paths.push(directory);
    const file = join(directory, "claims.sqlite"); await fixture.database.backup(file);
    const database = openDatabase(file); opened.push(database); const restored = createSqlitePorts(database);
    expect(restored.syncClaims.assertCurrent(fence(first.token))).toMatchObject({ ...first, invocationStarted: true,
      invocationKind: "create", requiresReconciliation: true });
    milliseconds += 1000;
    expect(workflow(restored).claim(intent.id, "restarted", 1000).claim.requiresReconciliation).toBe(true);
  });

  it("rolls back expired attempt, new claim and audit together on claim audit failure", () => {
    const first = claims.claim(intent.id, "first", 1000).claim; claims.markInvoking(intent.id, first.token);
    milliseconds += 1000; const before = counts();
    fixture.database.exec(`CREATE TRIGGER reject_claim_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'sync_attempt.claimed' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    expect(() => claims.claim(intent.id, "second", 1000)).toThrow("audit unavailable");
    expect(counts()).toEqual(before);
    expect(ports.syncIntents.listAttempts(intent.id)[0]!.resultStatus).toBe("started");
    fixture.database.exec("DROP TRIGGER reject_claim_audit");
    expect(claims.claim(intent.id, "retry", 1000).claim.requiresReconciliation).toBe(true);
  });

  it("rolls back invocation and failure when their audit cannot be persisted", () => {
    const claim = claims.claim(intent.id, "first", 1000).claim;
    fixture.database.exec(`CREATE TRIGGER reject_outcome_audit BEFORE INSERT ON audit_log
      WHEN NEW.action != 'sync_attempt.claimed' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    expect(() => claims.markInvoking(intent.id, claim.token)).toThrow("audit unavailable");
    expect(ports.syncClaims.assertCurrent(fence(claim.token))).toEqual(claim);
    expect(() => claims.fail(intent.id, claim.token, { code: "FAILED" })).toThrow("audit unavailable");
    expect(ports.syncIntents.listAttempts(intent.id)[0]!.resultStatus).toBe("started");
  });

  it("fences success and atomically commits artifacts and outcome, blocking all later claims", () => {
    const first = claims.claim(intent.id, "first", 1000).claim; claims.markInvoking(intent.id, first.token);
    const success = { ...fence(first.token), externalWorkItemId: "external-item", response: { id: "provider-id" } };
    expect(() => ports.syncClaims.completeSuccess(success)).toThrow("processor transaction");
    expect(() => ports.transactions.run(() => ports.syncClaims.completeSuccess(success))).toThrow("matching item");
    milliseconds += 1000;
    const recovered = claims.claim(intent.id, "recovery", 1000).claim; claims.markInvoking(intent.id, recovered.token);
    expect(() => ports.transactions.run(() => { persistSuccessArtifacts(); ports.syncClaims.completeSuccess({ ...success, now: now() }); }))
      .toThrow("expired, released");
    expect(fixture.database.prepare("SELECT id FROM external_work_items").all()).toEqual([]);
    ports.transactions.run(() => { persistSuccessArtifacts(); ports.syncClaims.completeSuccess({ ...success, ...fence(recovered.token) }); });
    expect(ports.syncIntents.listAttempts(intent.id)[1]).toMatchObject({ resultStatus: "succeeded", externalWorkItemId: "external-item" });
    expect(() => claims.claim(intent.id, "later", 1000)).toThrow("already succeeded");
    expect(ports.syncIntents.findById(intent.id)).toEqual(intent);
  });

  it("retains uncertainty when success persistence fails after provider invocation", () => {
    const first = claims.claim(intent.id, "first", 1000).claim; claims.markInvoking(intent.id, first.token);
    fixture.database.exec(`CREATE TRIGGER reject_success BEFORE INSERT ON audit_log
      WHEN NEW.action = 'sync_attempt.succeeded' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    expect(() => ports.transactions.run(() => { persistSuccessArtifacts(); ports.syncClaims.completeSuccess({
      ...fence(first.token), externalWorkItemId: "external-item", response: {} }); })).toThrow("audit unavailable");
    expect(fixture.database.prepare("SELECT id FROM external_work_items").all()).toEqual([]);
    expect(ports.syncIntents.listAttempts(intent.id)[0]!.resultStatus).toBe("started");
    milliseconds += 1000;
    expect(claims.claim(intent.id, "recovery", 1000).claim.requiresReconciliation).toBe(true);
  });

  it("rejects stale time and reused historical token without partial recovery", () => {
    const old = claims.claim(intent.id, "first", 1000).claim; claims.fail(intent.id, old.token, { code: "BEFORE_INVOCATION" });
    const before = counts();
    expect(() => ports.syncClaims.claim({ intentId: intent.id, workerId: "second", token: old.token,
      attemptId: next(), now: now(), expiresAt: "2026-09-28T00:00:01.000Z", auditId: next() })).toThrow("UNIQUE");
    expect(counts()).toEqual(before);
    milliseconds -= 1;
    expect(() => claims.claim(intent.id, "second", 1000)).toThrow("backwards");
    expect(() => ports.syncClaims.claim({ intentId: intent.id, workerId: "second", token: next(), attemptId: next(),
      now: "2026-09-28", expiresAt: "2026-09-28T00:00:01.000Z", auditId: next() })).toThrow("canonical UTC");
    expect(counts()).toEqual(before);
  });
});
