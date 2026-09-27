import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { ApplicationError } from "../../domain/errors.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createMcpServer } from "./server.js";

type Fixture = ReturnType<typeof acceptanceFixture>;
const archivedSources: [string, (f: Fixture) => string, string][] = [
  ["projects", f => f.project.id, "project_archived"],
  ["product_briefs", f => f.productBrief.productBrief.id, "product_brief_not_found"],
  ["product_brief_versions", f => f.productBrief.version.id, "product_brief_version_archived"],
  ["tickets", f => f.ticket.id, "ticket_archived"],
  ["ticket_revisions", f => f.revision.id, "ticket_revision_archived"],
  ["implementation_targets", f => f.briefs[0]!.implementationTargetId, "implementation_target_archived"],
  ["repositories", f => f.revision.requiredTargets[0]!.repository_id, "repository_archived"],
  ["implementation_briefs", f => f.briefs[0]!.id, "implementation_brief_archived"],
  ["graph_nodes", f => f.goal, "graph_node_archived"]
];

async function setup() {
  const fixture = acceptanceFixture();
  const server = createMcpServer(fixture.service);
  const target = new Client({ name: "handoff-lifecycle-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await target.connect(clientTransport);
  return { ...fixture, target, command: { implementation_brief_id: fixture.briefs[0]!.id,
    current_repository_state: { commit_sha: "abc123", dirty_state_fingerprint: null } },
    changes: () => fixture.database.prepare("SELECT total_changes() AS count").get(),
    async close() { await target.close(); await server.close(); fixture.database.close(); }
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
async function expectStale(f: Setup, reason: string) {
  const before = f.changes();

  const response = await f.target.callTool({ name: "get_implementation_handoff", arguments: f.command });

  expect(response.isError).toBe(true);
  const envelope = JSON.parse((response.content as { text: string }[])[0]!.text);
  expect(envelope).toMatchObject({ ok: false, error: { code: "STALE_HANDOFF", details: { reason } } });
  expect(Object.keys(envelope.error.details).length).toBeGreaterThan(1);
  expect(envelope).not.toHaveProperty("data");
  expect(response).not.toHaveProperty("structuredContent");
  expect(f.changes()).toEqual(before);
}

it.each(archivedSources)("blocks archived %s without a payload or writes", async (table, id, reason) => {
  const f = await setup();
  try {
    f.database.prepare(`UPDATE ${table} SET lifecycle_status = 'archived' WHERE id = ?`).run(id(f));

    await expectStale(f, reason);
  } finally { await f.close(); }
});

const unverifiableSources: [string, (f: Fixture) => void, string][] = [
  ["missing snapshot", f => { f.ports.repositoryContextSnapshots.findById = () => null; }, "repository_context_snapshot_not_found"],
  ["missing graph revision", f => { f.ports.graphRevisions.findById = () => null; }, "product_intent_reconciliation_unverifiable"],
  ["wrong snapshot repository", f => {
    const snapshot = f.ports.repositoryContextSnapshots.findById(f.briefs[0]!.repositoryContextSnapshotId)!;
    f.ports.repositoryContextSnapshots.findById = () => ({ ...snapshot, repositoryId: "other" });
  }, "repository_context_snapshot_identity_mismatch"],
  ["unverifiable baseline", f => {
    const snapshot = f.ports.repositoryContextSnapshots.findById(f.briefs[0]!.repositoryContextSnapshotId)!;
    f.ports.repositoryContextSnapshots.findById = () => ({ ...snapshot, baselineCommitSha: null });
  }, "repository_context_snapshot_unverifiable"],
  ["wrong target project", f => {
    const target = f.ports.implementationTargets.findById(f.briefs[0]!.implementationTargetId)!;
    f.ports.implementationTargets.findById = () => ({ ...target, projectId: "other" });
  }, "implementation_target_identity_mismatch"],
  ["wrong revision ticket", f => {
    f.ports.ticketRevisions.findById = () => ({ ...f.revision, ticketId: "other" });
  }, "ticket_revision_identity_mismatch"],
  ["target no longer required", f => {
    f.ports.ticketRevisions.findById = () => ({ ...f.revision, requiredTargets: [] });
  }, "implementation_target_not_required"],
  ["wrong graph provenance", f => {
    f.ports.graphRevisions.findById = () => ({ ...f.graph.graphRevision, sourceProductBriefVersionId: "other" });
  }, "product_intent_reconciliation_unverifiable"],
  ["unapproved bound version", f => {
    f.ports.productBriefVersions.findById = () => ({ ...f.productBrief.version, reviewStatus: "draft" });
  }, "product_brief_version_not_approved"]
];

it.each(unverifiableSources)("blocks %s without a payload or writes", async (_name, mutate, reason) => {
  const f = await setup();
  try {
    mutate(f);

    await expectStale(f, reason);
  } finally { await f.close(); }
});

it("retains NOT_FOUND for an unknown requested brief and storage errors for failed reads", async () => {
  const f = await setup();
  try {
    const before = f.changes();

    const missing = await f.target.callTool({ name: "get_implementation_handoff",
      arguments: { ...f.command, implementation_brief_id: "missing" } });
    f.ports.repositoryContextSnapshots.findById = () => { throw new ApplicationError("STORAGE_ERROR", "Read failed"); };
    const failure = await f.target.callTool({ name: "get_implementation_handoff", arguments: f.command });

    expect(JSON.parse((missing.content as { text: string }[])[0]!.text)).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(JSON.parse((failure.content as { text: string }[])[0]!.text)).toMatchObject({ error: { code: "STORAGE_ERROR" } });
    expect(f.changes()).toEqual(before);
  } finally { await f.close(); }
});

it("retains current handoff and repository drift guards", async () => {
  const f = await setup();
  try {
    const before = f.changes();

    const current = await f.target.callTool({ name: "get_implementation_handoff", arguments: f.command });
    f.command.current_repository_state.commit_sha = "changed";
    await expectStale(f, "repository_baseline_mismatch");

    expect(current.structuredContent).toMatchObject({ ok: true, data: { freshness: "current",
      implementation_brief: { id: f.briefs[0]!.id }, ticket_revision: { id: f.revision.id } } });
    expect(f.changes()).toEqual(before);
  } finally { await f.close(); }
});

it("reuses the original handoff after a no-op reconciliation and rejects dirty drift", async () => {
  const f = await setup();
  try {
    const version = f.service.createProductBriefDraft({ projectId: f.project.id, sourceIdeaId: f.idea.id,
      baseApprovedVersionId: f.productBrief.version.id, brief: { ...f.productBrief.version.brief, product_goal: "Clarified intent" } });
    f.service.approveProductBriefVersion(version.version.id);
    await expectStale(f, "product_intent_unreconciled");
    const graph = f.service.createGraphDraftBatch({ projectId: f.project.id, baseGraphRevisionId: f.graph.graphRevision.id,
      sourceProductBriefVersionId: version.version.id, changes: [], reconciliationSummary: "Existing goal remains valid" });
    f.service.approveGraphDraftBatch(graph.graphDraftBatch.id);
    const before = f.changes();

    const response = await f.target.callTool({ name: "get_implementation_handoff", arguments: f.command });
    const dirty = await f.target.callTool({ name: "get_implementation_handoff", arguments: { ...f.command,
      current_repository_state: { commit_sha: "abc123", dirty_state_fingerprint: "changed" } } });

    expect(response.structuredContent).toMatchObject({ ok: true, data: { freshness: "current",
      implementation_brief: { id: f.briefs[0]!.id }, product_brief_version: { id: f.productBrief.version.id } } });
    expect(JSON.parse((dirty.content as { text: string }[])[0]!.text)).toMatchObject({ error: {
      code: "STALE_HANDOFF", details: { reason: "repository_dirty_state_mismatch" } } });
    expect(f.changes()).toEqual(before);
  } finally { await f.close(); }
});

it.each(["projects", "product_briefs"])("retains stale Result submission and rejects Acceptance for archived %s", table => {
  const f = acceptanceFixture();
  try {
    const result = f.submit().implementationResult;
    f.database.prepare(`UPDATE ${table} SET lifecycle_status = 'archived'`).run();
    const before = f.database.prepare("SELECT total_changes() AS count").get();

    expect(() => f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept" }))
      .toThrow(expect.objectContaining({ code: "STALE_HANDOFF" }));
    expect(f.database.prepare("SELECT total_changes() AS count").get()).toEqual(before);
    const late = f.service.submitImplementationResult({ implementationBriefId: f.briefs[0]!.id,
      observedEvidenceIds: f.ports.implementationResults.listEvidenceIds(result.id), summary: "Late submission",
      unfinishedItems: [], criterionVerdicts: f.ports.implementationResults.listVerdicts(result.id).map(verdict => ({
        acceptanceCriterionId: verdict.acceptanceCriterionId, verdict: verdict.verdict,
        reason: verdict.reason, evidenceIds: verdict.evidenceIds
      })) }).implementationResult;

    expect(late).toMatchObject({ lifecycleStatus: "archived", staleAtSubmission: true });
    expect(late.staleReasons.length).toBeGreaterThan(0);
    expect(f.ports.resultAcceptances.findByResultId(result.id)).toBeNull();
  } finally { f.database.close(); }
});

it.each([
  ["projects", "project_not_found"],
  ["implementationTargets", "implementation_target_not_found"],
  ["tickets", "ticket_not_found"],
  ["ticketRevisions", "ticket_revision_not_found"],
  ["repositories", "repository_not_found"],
  ["productBriefVersions", "product_brief_version_not_found"]
] as const)("blocks missing %s port records", async (port, reason) => {
  const f = await setup();
  try {
    f.ports[port].findById = () => null;

    await expectStale(f, reason);
  } finally { await f.close(); }
});

it("still permits Revocation after the Project and Product Brief leave active scope", () => {
  const f = acceptanceFixture();
  try {
    const result = f.submit().implementationResult;
    f.service.acceptImplementationResult({ implementationResultId: result.id, idempotencyKey: "accept" });
    const acceptance = f.ports.resultAcceptances.findByResultId(result.id)!;
    f.database.prepare("UPDATE projects SET lifecycle_status = 'archived'").run();
    f.database.prepare("UPDATE product_briefs SET lifecycle_status = 'archived'").run();

    const revoked = f.service.revokeResultAcceptance({ resultAcceptanceId: acceptance.id, idempotencyKey: "revoke",
      reason: "Evidence was invalid", nextDeliveryStatus: "blocked" });

    expect(revoked.data.ticket).toEqual({ id: f.ticket.id, delivery_status: "blocked" });
    expect(f.ports.resultRevocations.findByAcceptanceId(acceptance.id)?.resultAcceptanceId).toBe(acceptance.id);
  } finally { f.database.close(); }
});
