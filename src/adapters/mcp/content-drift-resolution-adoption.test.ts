// 透過正式 adoption command 驗證歷史讀取；reserved association fixtures 不替代此整合流程。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";
import { contentDriftAdoptionFixture } from "../../test-support/content-drift-adoption-fixture.js";
import { evaluateTicketSourceFreshness } from "../../application/implementation-freshness.js";
import { createMcpServer } from "./server.js";
import type { serializeContentDriftResolution } from "./content-drift-resolution-serialization.js";
import type { serializePlaneObservationHistory } from "./plane-observation-read-tools.js";

type Fixture = Awaited<ReturnType<typeof contentDriftAdoptionFixture>>;
type Resolution = ReturnType<typeof serializeContentDriftResolution>;
type History = ReturnType<typeof serializePlaneObservationHistory>;
type Session = Awaited<ReturnType<typeof connect>>;

it.each(["brief-change", "milestone-change", "spec-change", "spec-move", "spec-archive", "milestone-archive", "reconfirmation"])(
  "reads real adoption before/after approval and %s without applying current ancestry freshness", async scenario => {
    const f = await contentDriftAdoptionFixture();
    const captured = f.capture();
    const { milestone, spec } = f.hierarchy();
    const current = f.attach(spec.node.id);
    const session = await connect(f);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider call"));
    try {
      expect((await readAll(session, f, captured.drift!.id)).resolution).toBeNull();
      const adopted = await session.call<Resolution>("adopt_content_drift", command(f, captured.drift!.id, spec.node.id));
      const candidate = await readAll(session, f, captured.drift!.id);
      expect(candidate).toEqual({ content_drift_id: adopted.content_drift_id, evidence: adopted.evidence, resolution: adopted.resolution });
      expect(candidate).toMatchObject({ evidence: { captured_source_ticket_revision_id: f.revision.id },
        resolution: { record: { kind: "adopt" }, draft: { review_status: "draft", lifecycle_status: "active",
          base_approved_revision_id: current.id, source_graph_revision_id: f.currentGraph() } } });
      expect(candidate.resolution!.draft!.specification.source_spec_id).toBe(spec.node.id);
      expect(f.allRows().result_acceptances).toEqual([]);
      const draftId = candidate.resolution!.draft!.id;
      await session.call("approve_ticket_revision", { ticket_revision_id: draftId });
      const approved = await readAll(session, f, captured.drift!.id);
      expect(approved.resolution!.draft!.review_status).toBe("approved");
      expect(approved.resolution!.decision).toEqual(candidate.resolution!.decision);

      if (scenario === "brief-change" || scenario === "reconfirmation") f.changeBrief();
      if (scenario === "milestone-change") f.service.planning.save({ projectId: f.project.id, nodeId: milestone.node.id,
        baseGraphRevisionId: f.currentGraph(), title: "Expanded stage", document: f.milestoneDocument });
      if (scenario === "spec-change") f.service.planning.save({ projectId: f.project.id, nodeId: spec.node.id,
        parentNodeId: milestone.node.id, baseGraphRevisionId: f.currentGraph(), title: "Changed capability", document: f.specDocument });
      if (scenario === "spec-move") {
        const other = f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: f.currentGraph(),
          title: "Other stage", document: f.milestoneDocument });
        f.service.planning.save({ projectId: f.project.id, nodeId: spec.node.id, parentNodeId: other.node.id,
          baseGraphRevisionId: f.currentGraph(), title: "Spec", document: f.specDocument });
      }
      if (scenario === "spec-archive" || scenario === "milestone-archive") f.service.planning.archive({ projectId: f.project.id,
        baseGraphRevisionId: f.currentGraph(), nodeId: scenario === "spec-archive" ? spec.node.id : milestone.node.id });
      if (scenario === "reconfirmation") {
        // 根節點已同步但後代 stale 時，歷史仍可讀；重新確認不替換候選的來源 identity。
        expect(await readAll(session, f, captured.drift!.id)).toEqual(approved);
        f.service.planning.save({ projectId: f.project.id, nodeId: milestone.node.id, baseGraphRevisionId: f.currentGraph(),
          title: "Stage", document: f.milestoneDocument });
        const confirmed = f.service.planning.save({ projectId: f.project.id, nodeId: spec.node.id, parentNodeId: milestone.node.id,
          baseGraphRevisionId: f.currentGraph(), title: "Spec", document: f.specDocument });
        expect(confirmed.node.metadata.content_revision_id).toBe(spec.node.metadata.content_revision_id);
      }
      const freshness = evaluateTicketSourceFreshness(f.ports, f.ports.tickets.findById(f.ticket.id)!, f.ports.ticketRevisions.findById(draftId)!);
      if (scenario === "reconfirmation") expect(freshness).toBeNull();
      else expect(freshness).not.toBeNull();

      expect(await readAll(session, f, captured.drift!.id)).toEqual(approved);
      expect(f.ports.tickets.findById(f.ticket.id)!.deliveryStatus).toBe("planned");
      expect(f.allRows().result_acceptances).toEqual([]);
      expect(f.service.getMappingSyncHealth(f.mapping.id).syncHealth).toBe("pending");
      expect(f.database.prepare("SELECT resolution_decision_id AS raw FROM content_drifts WHERE id = ?").get(captured.drift!.id)).toEqual({ raw: null });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); await session.close(); f.database.close(); }
  });

it("reads an actual adopted candidate after competing approval archives it, then after mapping and owner archival", async () => {
  const f = await contentDriftAdoptionFixture();
  const first = f.capture({ id: "first" });
  const second = f.capture({ id: "second" });
  const session = await connect(f);
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider call"));
  try {
    const original = await session.call<Resolution>("adopt_content_drift", command(f, first.drift!.id));
    expect(await readAll(session, f, first.drift!.id)).toEqual({ content_drift_id: original.content_drift_id, evidence: original.evidence, resolution: original.resolution });
    const competing = await session.call<Resolution>("adopt_content_drift", command(f, second.drift!.id));
    await session.call("approve_ticket_revision", { ticket_revision_id: competing.resolution!.draft!.id });
    const archived = await readAll(session, f, first.drift!.id);
    expect(archived.resolution!.draft).toMatchObject({ id: original.resolution!.draft!.id,
      review_status: "draft", lifecycle_status: "archived", base_approved_revision_id: f.revision.id });
    expect(archived.resolution!.record).toEqual(original.resolution!.record);
    expect(archived.resolution!.decision).toEqual(original.resolution!.decision);
    const before = f.allRows();
    const failedApproval = await session.client.callTool({ name: "approve_ticket_revision", arguments: { ticket_revision_id: original.resolution!.draft!.id } });
    expect(failedApproval.isError).toBe(true);
    expect(f.allRows()).toEqual(before);
    await session.call("terminate_sync_mapping", { mapping_id: f.mapping.id, reason: "保留已處置歷史" });
    f.database.prepare("UPDATE tickets SET lifecycle_status = 'archived' WHERE id = ?").run(f.ticket.id);
    f.database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(f.project.id);

    expect(await readAll(session, f, first.drift!.id)).toEqual(archived);
    expect((await readAll(session, f, second.drift!.id)).resolution!.draft!.review_status).toBe("approved");
    expect(f.allRows().result_acceptances).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); await session.close(); f.database.close(); }
});

function command(f: Fixture, driftId: string, specId?: string) {
  return { content_drift_id: driftId, reason: "採用選定文字",
    base_approved_revision_id: f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!,
    source_graph_revision_id: f.currentGraph(), specification: { title: "Selected title", user_story: "Selected wording",
      scope: ["Feature"], acceptance_criteria: ["Works"], non_goals: [], related_graph_node_ids: specId ? [] : [f.goal],
      implementation_targets: f.revision.requiredTargets, implementation_notes: [], ...(specId ? { source_spec_id: specId } : {}) } };
}
async function connect(f: Fixture) {
  const server = createMcpServer(f.service, { profile: "full" });
  const client = new Client({ name: "resolution-adoption-integration", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client,
    async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true);
      return (response.structuredContent as { data: T }).data;
    },
    async resource<T>(uri: string): Promise<T> {
      const response = await client.readResource({ uri });
      return JSON.parse(String(response.contents[0]!.text)) as T;
    },
    async close() { await client.close(); await server.close(); }
  };
}
async function readAll(session: Session, f: Fixture, driftId: string) {
  const before = f.allRows();
  const clockCalls = f.clockCalls();
  const single = await session.call<Resolution>("get_content_drift_resolution", { content_drift_id: driftId });
  expect(await session.resource<Resolution>(`product-graph://content-drifts/${driftId}/resolution`)).toEqual(single);
  const history = await session.call<History>("get_mapping_content_drift_history", { mapping_id: f.mapping.id });
  expect(await session.resource<History>(`product-graph://external-work-item-mappings/${f.mapping.id}/content-drifts`)).toEqual(history);
  const drift = history.drifts.find(value => value.id === driftId)!;
  expect(drift.resolution).toEqual(single.resolution);
  expect(drift.resolution_decision_id).toBe(single.resolution?.decision.id ?? null);
  expect(f.allRows()).toEqual(before);
  expect(f.clockCalls()).toBe(clockCalls);
  return single;
}
