import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { openDatabase, type SqliteDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import { toTicketSpecInput } from "../adapters/mcp/input-mappers.js";
import { isValid, ulid } from "ulid";

const databases: SqliteDatabase[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const f = acceptanceFixture();
  databases.push(f.database);
  const specification = { title: "Follow-up", userStory: "More work", scope: ["New work"],
    acceptanceCriteria: ["Verified"], nonGoals: [], relatedGraphNodeIds: [f.goal],
    implementationTargets: f.revision.requiredTargets.map(target => ({ repositoryId: target.repository_id, scope: target.scope })),
    implementationNotes: [] };
  const input = { projectId: f.project.id, sourceGraphRevisionId: f.graph.graphRevision.id, sourceNodeIds: [f.goal] };
  const create = (target: string | null = f.ticket.id) => f.service.createTicketDraftBatch({ ...input,
    tickets: [{ ...specification, tracesToTicketId: target }] }).tickets[0]!;
  const edges = (id: string) => f.ports.graphEdges.list(f.project.id).filter(edge => edge.sourceNodeId === id && edge.relationType === "traces_to");
  return { ...f, specification, input, create, edges };
}
function snapshot(database: SqliteDatabase) {
  return Object.fromEntries(["tickets", "ticket_revisions", "ticket_draft_batches", "graph_nodes", "graph_edges", "graph_revisions",
    "implementation_results", "result_acceptances", "implementation_briefs", "implementation_targets", "audit_log"]
    .map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
}

describe("Follow-up Ticket lineage", () => {
  it.each(["active", "archived"])("traces to %s originals without changing their completion or product intent", lifecycle => {
    const f = fixture();
    const result = f.submit();
    f.service.acceptImplementationResult({ implementationResultId: result.implementationResult.id, idempotencyKey: "accept" });
    f.database.prepare("UPDATE tickets SET lifecycle_status = ? WHERE id = ?").run(lifecycle, f.ticket.id);
    const before = snapshot(f.database);
    const project = f.ports.projects.findById(f.project.id);

    const followup = f.create();
    f.service.approveTicketRevision(followup.revision.id);

    const edge = f.edges(followup.ticket.id)[0]!;
    expect(isValid(edge.id)).toBe(true);
    expect(edge).toMatchObject({ sourceNodeId: followup.ticket.id, targetNodeId: f.ticket.id, lifecycleStatus: "active",
      createdInGraphRevisionId: null, lastChangedInGraphRevisionId: null,
      metadata: { owner_ticket_id: followup.ticket.id, established_by_ticket_revision_id: followup.revision.id } });
    const after = snapshot(f.database);
    for (const table of ["tickets", "ticket_revisions", "graph_nodes", "implementation_results", "result_acceptances", "implementation_briefs"]) {
      expect(after[table]).toEqual(expect.arrayContaining(before[table] as unknown[]));
    }
    expect(after.graph_revisions).toEqual(before.graph_revisions);
    expect(f.ports.projects.findById(f.project.id)).toEqual(project);
    const audits = f.ports.auditLog.list().filter(audit => ["ticket_revision.approved", "ticket_draft_batch.created"].includes(audit.action));
    expect(JSON.stringify(audits)).toContain(edge.id);
    expect(f.database.pragma("foreign_key_check")).toEqual([]);
  });

  it("preserves edge identity when omitted, delays target changes until approval, and archives explicit null", () => {
    const f = fixture();
    const followup = f.create();
    const firstEdge = f.edges(followup.ticket.id)[0]!;
    f.service.approveTicketRevision(followup.revision.id);
    const replacement = (base: string, trace: { tracesToTicketId?: string | null }) => f.service.createTicketRevisionDraft({
      ticketId: followup.ticket.id, baseApprovedRevisionId: base, sourceGraphRevisionId: f.graph.graphRevision.id,
      specification: { ...f.specification, ...trace } });

    const inherited = replacement(followup.revision.id, {});
    expect(inherited.revision.specification.traces_to_ticket_id).toBe(f.ticket.id);
    f.service.approveTicketRevision(inherited.revision.id);
    expect(f.edges(followup.ticket.id)).toEqual([firstEdge]);
    const newOriginal = f.create(null);
    const changed = replacement(inherited.revision.id, { tracesToTicketId: newOriginal.ticket.id });
    expect(f.edges(followup.ticket.id)).toEqual([firstEdge]);
    f.service.approveTicketRevision(changed.revision.id);
    expect(f.edges(followup.ticket.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstEdge.id, lifecycleStatus: "archived" }),
      expect.objectContaining({ targetNodeId: newOriginal.ticket.id, lifecycleStatus: "active",
        metadata: { owner_ticket_id: followup.ticket.id, established_by_ticket_revision_id: changed.revision.id } })
    ]));
    const removed = replacement(changed.revision.id, { tracesToTicketId: null });
    expect(f.edges(followup.ticket.id).filter(edge => edge.lifecycleStatus === "active")).toHaveLength(1);
    f.service.approveTicketRevision(removed.revision.id);
    expect(f.edges(followup.ticket.id)).toHaveLength(2);
    expect(f.edges(followup.ticket.id).every(edge => edge.lifecycleStatus === "archived")).toBe(true);
  });

  it("rejects unknown, cross-project and self references and rolls back a partially created batch", () => {
    const f = fixture();
    const foreignProject = f.service.createProject({ name: "Other Project" }).project;
    const foreignId = ulid();
    f.ports.tickets.insert({ ...f.ticket, id: foreignId, projectId: foreignProject.id, currentApprovedRevisionId: null });
    const before = snapshot(f.database);
    expect(() => f.create("missing")).toThrow("Traced Ticket");
    expect(() => f.create(foreignId)).toThrow("Traced Ticket");
    expect(() => f.service.createTicketDraftBatch({ ...f.input, tickets: [
      { ...f.specification, tracesToTicketId: f.ticket.id }, { ...f.specification, tracesToTicketId: "missing" }
    ] })).toThrow();
    expect(() => f.service.createTicketRevisionDraft({ ticketId: f.ticket.id, baseApprovedRevisionId: f.revision.id,
      sourceGraphRevisionId: f.graph.graphRevision.id, specification: { ...f.specification, tracesToTicketId: f.ticket.id } })).toThrow("itself");
    expect(snapshot(f.database)).toEqual(before);
  });

  it("rolls back approval edge archival, pointer and artifacts when audit persistence fails", () => {
    const f = fixture();
    const followup = f.create();
    f.service.approveTicketRevision(followup.revision.id);
    const replacement = f.service.createTicketRevisionDraft({ ticketId: followup.ticket.id,
      baseApprovedRevisionId: followup.revision.id, sourceGraphRevisionId: f.graph.graphRevision.id,
      specification: { ...f.specification, tracesToTicketId: null } });
    const before = snapshot(f.database);
    vi.spyOn(f.ports.auditLog, "append").mockImplementation(() => { throw new Error("disk failure"); });

    expect(() => f.service.approveTicketRevision(replacement.revision.id)).toThrow("disk failure");
    expect(snapshot(f.database)).toEqual(before);
  });

  it("enforces unique active lineage and immutable historical endpoints in SQLite", () => {
    const f = fixture();
    const followup = f.create();
    const edge = f.edges(followup.ticket.id)[0]!;
    expect(() => f.ports.graphEdges.insert({ ...edge, id: ulid() })).toThrow("already has active lineage");
    expect(() => f.database.prepare("UPDATE graph_edges SET target_node_id = ? WHERE id = ?")
      .run(followup.ticket.id, edge.id)).toThrow("immutable");
    f.ports.graphEdges.archive(edge.id, null, f.project.updatedAt);
    expect(() => f.database.prepare("UPDATE graph_edges SET lifecycle_status = 'active' WHERE id = ?")
      .run(edge.id)).toThrow("immutable");
  });

  it("keeps omitted versus explicit null distinct across the MCP input mapper", () => {
    const specification = { title: "Follow-up", user_story: "New work", scope: [], acceptance_criteria: ["Verified"],
      non_goals: [], related_graph_node_ids: ["goal"], implementation_targets: [{ repository_id: "repo", scope: [] }], implementation_notes: [] };
    expect(toTicketSpecInput(specification).tracesToTicketId).toBeUndefined();
    expect(toTicketSpecInput({ ...specification, traces_to_ticket_id: null }).tracesToTicketId).toBeNull();
  });
});

describe("Ticket lineage forward migration", () => {
  it("backfills current approved or initial draft, ignores pending replacements, and survives restart", async () => {
    const f = fixture();
    const initial = f.create();
    const approved = f.create();
    f.service.approveTicketRevision(approved.revision.id);
    f.service.createTicketRevisionDraft({ ticketId: approved.ticket.id, baseApprovedRevisionId: approved.revision.id,
      sourceGraphRevisionId: f.graph.graphRevision.id, specification: { ...f.specification, tracesToTicketId: null } });
    const directory = mkdtempSync(join(tmpdir(), "lineage-migration-"));
    directories.push(directory);
    const path = join(directory, "db.sqlite");
    await f.database.backup(path);
    const legacy = new Database(path);
    legacy.exec("DROP TRIGGER validate_ticket_lineage_insert; DROP TRIGGER protect_ticket_lineage_update; DELETE FROM graph_edges WHERE created_in_graph_revision_id IS NULL; DELETE FROM schema_migrations WHERE version = '004_ticket_lineage.sql';");
    legacy.close();

    const first = openDatabase(path);
    databases.push(first);
    const edges = createSqlitePorts(first).graphEdges.list(f.project.id);
    expect(edges).toHaveLength(2);
    for (const ticket of [initial, approved]) expect(edges).toContainEqual(expect.objectContaining({
      sourceNodeId: ticket.ticket.id, targetNodeId: f.ticket.id,
      metadata: { owner_ticket_id: ticket.ticket.id, established_by_ticket_revision_id: ticket.revision.id }
    }));
    expect(edges.every(edge => isValid(edge.id))).toBe(true);
    first.close();
    const reopened = openDatabase(path);
    databases.push(reopened);
    expect(createSqlitePorts(reopened).graphEdges.list(f.project.id)).toEqual(edges);
    expect(reopened.pragma("foreign_key_check")).toEqual([]);
    expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rolls back migration and its version when legacy lineage is invalid", async () => {
    const f = fixture();
    const initial = f.create();
    const directory = mkdtempSync(join(tmpdir(), "lineage-invalid-"));
    directories.push(directory);
    const path = join(directory, "db.sqlite");
    await f.database.backup(path);
    const legacy = new Database(path);
    legacy.exec("DROP TRIGGER validate_ticket_lineage_insert; DROP TRIGGER protect_ticket_lineage_update; DELETE FROM graph_edges WHERE created_in_graph_revision_id IS NULL; DELETE FROM schema_migrations WHERE version = '004_ticket_lineage.sql';");
    legacy.prepare("UPDATE ticket_revisions SET specification_json = json_set(specification_json, '$.traces_to_ticket_id', 'missing') WHERE id = ?").run(initial.revision.id);
    legacy.close();

    expect(() => openDatabase(path)).toThrow("Legacy Ticket lineage is invalid");
    const raw = new Database(path);
    databases.push(raw);
    expect(raw.prepare("SELECT version FROM schema_migrations WHERE version = '004_ticket_lineage.sql'").get()).toBeUndefined();
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'validate_ticket_lineage_insert'").get()).toBeUndefined();
    expect(raw.prepare("SELECT id FROM graph_edges WHERE created_in_graph_revision_id IS NULL").all()).toEqual([]);
  });
});
