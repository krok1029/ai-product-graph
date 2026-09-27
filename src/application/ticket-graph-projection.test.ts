import Database from "better-sqlite3";
import { mkdtempSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ProductGraphService } from "./product-graph-service.js";
import { openDatabase, type SqliteDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";

const databases: SqliteDatabase[] = [];
const directories: string[] = [];
const migrations = fileURLToPath(new URL("../infrastructure/migrations", import.meta.url));
afterEach(() => {
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "ticket-projection-"));
  directories.push(directory);
  return directory;
}

function fixture(database = openDatabase(":memory:")) {
  databases.push(database);
  const ports = createSqlitePorts(database);
  const service = new ProductGraphService(ports);
  const project = service.createProject({ name: "Projection" }).project;
  const idea = service.addIdea({ projectId: project.id, content: "Plan", source: "test" }).idea;
  const brief = service.createProductBriefDraft({ projectId: project.id, sourceIdeaId: idea.id,
    baseApprovedVersionId: null, brief: { product_goal: "Deliver", target_users: [], pain_points: [],
      core_workflows: [], mvp_scope: [], non_goals: [], success_metrics: [], risks: [], open_questions: [] } });
  service.approveProductBriefVersion(brief.version.id);
  const batch = service.createGraphDraftBatch({ projectId: project.id, baseGraphRevisionId: null,
    sourceProductBriefVersionId: brief.version.id, changes: [{ changeId: "goal", operation: "add", entityKind: "node",
      targetId: null, payload: { type: "product_goal", title: "Deliver" } }] });
  const graph = service.approveGraphDraftBatch(batch.graphDraftBatch.id);
  const goal = graph.applied.addedIds[0]!;
  const repository = service.createRepository({ projectId: project.id, slug: "repo", name: "Repo" }).repository;
  const specification = { title: "Repeated title", userStory: "As a user, I can deliver.", scope: ["Feature"],
    acceptanceCriteria: ["Verified"], nonGoals: [], relatedGraphNodeIds: [goal],
    implementationTargets: [{ repositoryId: repository.id, scope: ["Feature"] }], implementationNotes: [] };
  const input = { projectId: project.id, sourceGraphRevisionId: graph.graphRevision.id, sourceNodeIds: [goal], tickets: [specification] };
  return { database, ports, service, project, brief, graph, goal, specification, input };
}

function counts(database: SqliteDatabase) {
  return Object.fromEntries(["tickets", "ticket_revisions", "ticket_draft_batches", "graph_nodes", "graph_edges", "graph_revisions", "audit_log"]
    .map(table => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()]));
}

describe("Ticket canonical graph projection", () => {
  it("keeps distinct identities and updates only the approved aggregate without moving graph pointers", () => {
    const f = fixture();
    const pointers = f.ports.projects.findById(f.project.id);
    const pending = f.service.createGraphDraftBatch({ projectId: f.project.id,
      baseGraphRevisionId: f.graph.graphRevision.id, sourceProductBriefVersionId: f.brief.version.id,
      changes: [], reconciliationSummary: "No product changes" });
    const first = f.service.createTicketDraftBatch({ ...f.input, tickets: [f.specification, f.specification] }).tickets;
    expect(first).toHaveLength(2);
    expect(first[0]!.ticket.id).not.toBe(first[1]!.ticket.id);
    for (const { ticket } of first) {
      expect(f.service.getNode(ticket.id).node).toMatchObject({ id: ticket.id, type: "ticket", title: ticket.title,
        source: "ticket", sourceRefType: "ticket", sourceRefId: ticket.id,
        createdInGraphRevisionId: null, lastChangedInGraphRevisionId: null });
    }
    const original = first[0]!;
    f.service.approveTicketRevision(original.revision.id);
    const replacement = f.service.createTicketRevisionDraft({ ticketId: original.ticket.id,
      baseApprovedRevisionId: original.revision.id, sourceGraphRevisionId: f.graph.graphRevision.id,
      specification: { ...f.specification, title: "Approved replacement" } });
    expect(f.service.getNode(original.ticket.id).node.title).toBe("Repeated title");
    f.service.approveTicketRevision(replacement.revision.id);
    expect(f.service.getNode(original.ticket.id).node.title).toBe("Approved replacement");
    expect(f.ports.ticketRevisions.findById(original.revision.id)?.title).toBe("Repeated title");
    expect(f.ports.projects.findById(f.project.id)).toEqual(pointers);
    expect(f.database.prepare("SELECT COUNT(*) AS count FROM graph_revisions").get()).toEqual({ count: 1 });
    expect(() => f.service.approveGraphDraftBatch(pending.graphDraftBatch.id)).not.toThrow();
    f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(original.ticket.id);
    expect(f.service.getNode(original.ticket.id).node.lifecycleStatus).toBe("archived");
  });

  it("rejects Ticket nodes as product intent sources and protects Ticket ownership from graph batches", () => {
    const f = fixture();
    const ticket = f.service.createTicketDraftBatch(f.input).tickets[0]!.ticket;
    const before = counts(f.database);
    expect(() => f.service.createTicketDraftBatch({ ...f.input, sourceNodeIds: [ticket.id] })).toThrow();
    expect(() => f.service.createTicketDraftBatch({ ...f.input,
      tickets: [{ ...f.specification, relatedGraphNodeIds: [f.goal, ticket.id] }] })).toThrow();
    expect(counts(f.database)).toEqual(before);
    const proposal = f.service.createGraphDraftBatch({ projectId: f.project.id,
      baseGraphRevisionId: f.graph.graphRevision.id, sourceProductBriefVersionId: f.brief.version.id,
      changes: [{ changeId: "overwrite", operation: "update", entityKind: "node", targetId: ticket.id,
        payload: { title: "Overwrite" } }] });
    expect(proposal.validation.conflicts).not.toHaveLength(0);
    expect(() => f.service.approveGraphDraftBatch(proposal.graphDraftBatch.id)).toThrow();
    expect(f.service.getNode(ticket.id).node.title).toBe(ticket.title);
  });

  it("rolls back the whole batch when its second Ticket fails", () => {
    const f = fixture();
    const before = counts(f.database);
    expect(() => f.service.createTicketDraftBatch({ ...f.input,
      tickets: [f.specification, { ...f.specification, implementationTargets: [{ repositoryId: "missing", scope: [] }] }] })).toThrow();
    expect(counts(f.database)).toEqual(before);
    expect(f.database.pragma("foreign_key_check")).toEqual([]);
  });

  it("requires revision provenance for product intent nodes and non-Ticket edges", () => {
    const f = fixture();
    expect(() => f.database.prepare("UPDATE graph_nodes SET created_in_graph_revision_id = NULL WHERE id = ?").run(f.goal)).toThrow();
    expect(() => f.ports.graphEdges.insert({ id: "bad-edge", projectId: f.project.id, sourceNodeId: f.goal,
      targetNodeId: f.goal, relationType: "traces_to", confidence: null, lifecycleStatus: "active",
      createdInGraphRevisionId: null, lastChangedInGraphRevisionId: null, metadata: {},
      createdAt: f.project.createdAt, updatedAt: f.project.updatedAt })).toThrow();
  });
});

describe("Ticket projection forward migration", () => {
  it("backfills old active and archived Tickets, preserving graph rows, references and indexes across reopen", () => {
    const directory = temporaryDirectory();
    for (const file of ["001_initial_schema.sql", "002_initial_indexes.sql"]) {
      copyFileSync(join(migrations, file), join(directory, file));
    }
    const path = join(directory, "legacy.sqlite");
    const f = fixture(openDatabase(path, { migrationsDirectory: directory }));
    const tickets = f.service.createTicketDraftBatch({ ...f.input, tickets: [f.specification, f.specification] }).tickets;
    f.service.approveTicketRevision(tickets[0]!.revision.id);
    f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(tickets[1]!.ticket.id);
    f.ports.graphEdges.insert({ id: "old-edge", projectId: f.project.id, sourceNodeId: f.goal, targetNodeId: f.goal,
      relationType: "supports", confidence: null, lifecycleStatus: "active", createdInGraphRevisionId: f.graph.graphRevision.id,
      lastChangedInGraphRevisionId: f.graph.graphRevision.id, metadata: { old: true }, createdAt: f.project.createdAt, updatedAt: f.project.updatedAt });
    const oldNode = f.ports.graphNodes.findById(f.goal);
    const oldEdge = f.ports.graphEdges.findById("old-edge");
    const oldProject = f.ports.projects.findById(f.project.id);
    const oldIndexes = f.database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('graph_nodes','graph_edges') ORDER BY name").all();
    f.database.close();

    for (let pass = 0; pass < 2; pass++) {
      const database = openDatabase(path);
      databases.push(database);
      const ports = createSqlitePorts(database);
      expect(ports.graphNodes.findById(f.goal)).toEqual(oldNode);
      expect(ports.graphEdges.findById("old-edge")).toEqual(oldEdge);
      expect(ports.projects.findById(f.project.id)).toEqual(oldProject);
      expect(ports.graphNodes.list(f.project.id)).toHaveLength(3);
      expect(ports.graphNodes.findById(tickets[0]!.ticket.id)).toMatchObject({ type: "ticket", lifecycleStatus: "active" });
      expect(ports.graphNodes.findById(tickets[1]!.ticket.id)).toMatchObject({ type: "ticket", lifecycleStatus: "archived" });
      expect(ports.ticketRevisions.listGraphNodeIds(tickets[0]!.revision.id)).toEqual([f.goal]);
      expect(database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('graph_nodes','graph_edges') ORDER BY name").all()).toEqual(oldIndexes);
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.pragma("foreign_key_check")).toEqual([]);
      database.close();
    }
  });

  it("rolls back a failed rebuild before recording its migration version", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "rollback.sqlite");
    for (const file of ["001_initial_schema.sql", "002_initial_indexes.sql"]) {
      copyFileSync(join(migrations, file), join(directory, file));
    }
    const f = fixture(openDatabase(path, { migrationsDirectory: directory }));
    const ticket = f.service.createTicketDraftBatch(f.input).tickets[0]!;
    const original = f.ports.graphNodes.findById(f.goal);
    const originalSchema = f.database.prepare("SELECT sql FROM sqlite_master WHERE name = 'graph_nodes'").get();
    f.database.close();
    const migration = "003_ticket_graph_projection.sql";
    writeFileSync(join(directory, migration), readFileSync(join(migrations, migration), "utf8") +
      "\nUPDATE graph_nodes SET project_id = 'missing';");
    expect(() => openDatabase(path, { migrationsDirectory: directory })).toThrow("integrity check failed");
    const raw = new Database(path);
    databases.push(raw);
    expect(raw.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(migration)).toBeUndefined();
    expect(raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'graph_nodes'").get()).toEqual(originalSchema);
    expect(raw.prepare("SELECT id FROM graph_nodes WHERE id = ?").get(ticket.ticket.id)).toBeUndefined();
    expect(raw.prepare("SELECT graph_node_id FROM ticket_revision_graph_nodes WHERE ticket_revision_id = ?").get(ticket.revision.id))
      .toEqual({ graph_node_id: f.goal });
    raw.close();
    const reopened = openDatabase(path);
    databases.push(reopened);
    expect(createSqlitePorts(reopened).graphNodes.findById(f.goal)).toEqual(original);
    expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
