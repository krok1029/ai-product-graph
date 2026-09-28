// Client 明確判斷規劃範圍，server 僅保證結構、版本與交易，不宣稱理解規格語意。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";
import { contentDriftAdoptionFixture } from "../../test-support/content-drift-adoption-fixture.js";
import { createMcpServer } from "./server.js";
import { readContentDriftResolution } from "../../application/content-drift-resolution-support.js";

type Fixture = Awaited<ReturnType<typeof contentDriftAdoptionFixture>>;
const specification = (f: Fixture, specId?: string) => ({ title: "Editorial title", user_story: "Selected external wording",
  scope: ["Feature"], acceptance_criteria: ["Works"], non_goals: [], related_graph_node_ids: specId ? [] : [f.goal],
  implementation_targets: f.revision.requiredTargets, implementation_notes: [], ...(specId ? { source_spec_id: specId } : {}) });
const command = (f: Fixture, driftId: string, specId?: string) => ({ content_drift_id: driftId, reason: "採用選定文字",
  base_approved_revision_id: f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!,
  source_graph_revision_id: f.currentGraph(), specification: specification(f, specId) });
async function connect(f: Fixture, profile: "core" | "full" = "full") {
  const server = createMcpServer(f.service, { profile });
  const client = new Client({ name: "adoption-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); f.database.close(); } };
}

it("enforces strict full command and specification shapes with server-owned identity, exact DTO and no provider calls", async () => {
  const f = await contentDriftAdoptionFixture();
  const captured = f.capture();
  const session = await connect(f);
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider call"));
  try {
    const input = command(f, captured.drift!.id);
    const before = f.allRows();
    for (const field of ["ticket_id", "project_id", "mapping_id", "actor_id", "created_at", "decision_id", "idempotency_key"]) {
      expect((await session.client.callTool({ name: "adopt_content_drift", arguments: { ...input, [field]: "injected" } })).isError).toBe(true);
    }
    for (const extra of [{ reason: " " }, { base_approved_revision_id: " " }, { source_graph_revision_id: " " },
      { specification: { ...input.specification, unexpected: true } },
      { specification: { ...input.specification, implementation_targets: [{ ...input.specification.implementation_targets[0], unexpected: true }] } }]) {
      expect((await session.client.callTool({ name: "adopt_content_drift", arguments: { ...input, ...extra } })).isError).toBe(true);
    }
    expect(f.allRows()).toEqual(before);
    const response = await session.client.callTool({ name: "adopt_content_drift", arguments: input });
    expect(response.isError).not.toBe(true);
    const view = readContentDriftResolution(f.ports, captured.drift!.id);
    expect(response.structuredContent).toMatchObject({ ok: true, audit_log_id: view.resolution!.record.auditLogId,
      data: { content_drift_id: captured.drift!.id, evidence: { ticket_id: f.ticket.id, mapping_id: f.mapping.id,
        snapshot_id: captured.snapshot.id, captured_source_ticket_revision_id: f.revision.id },
      resolution: { record: { kind: "adopt", draft_ticket_revision_id: view.resolution!.draft!.id },
        decision: { summary: input.reason, actor_id: "acceptance-user" }, draft: { review_status: "draft" } },
      proposed_implementation_targets: [{ implementation_target_id: f.briefs[0]!.implementationTargetId,
        repository_id: f.revision.requiredTargets[0]!.repository_id, scope: ["Feature"], identity_action: "reuse" }] } });
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); await session.close(); }
});

it("keeps core discovery at 23 and rejects invoking adoption there", async () => {
  const f = await contentDriftAdoptionFixture();
  const captured = f.capture();
  const session = await connect(f, "core");
  try {
    const before = f.allRows();
    const names = (await session.client.listTools()).tools.map(tool => tool.name);
    expect(names).toHaveLength(23);
    expect(names).not.toContain("adopt_content_drift");
    expect((await session.client.callTool({ name: "adopt_content_drift", arguments: command(f, captured.drift!.id) })).isError).toBe(true);
    expect(f.allRows()).toEqual(before);
  } finally { await session.close(); }
});

it("assesses existing-Spec edits, reconciles product changes first, and routes separate capability to planning without resolving its drift", async () => {
  const f = await contentDriftAdoptionFixture();
  const { milestone, spec } = f.hierarchy();
  const current = f.attach(spec.node.id);
  const existing = f.capture({ id: "existing-spec", revisionId: current.id });
  const expansion = f.capture({ id: "product-expansion", revisionId: current.id });
  const separate = f.capture({ id: "separate-capability", revisionId: current.id });
  const session = await connect(f);
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider call"));
  // 測試腳本扮演 client 的明確產品判斷；文字一致性不是 adoption server 的推論結果。
  async function call(name: string, args: Record<string, unknown>) {
    const response = await session.client.callTool({ name, arguments: args });
    expect(response.isError).not.toBe(true);
    return (response.structuredContent as { data: Record<string, any> }).data;
  }
  async function save(change: Record<string, unknown>) {
    return call("save_planning_node", { project_id: f.project.id, base_graph_revision_id: f.currentGraph(), change: { operation: "save", ...change } });
  }
  try {
    // 既有能力的文字修訂可以建立同一 mapped Ticket 的候選，不寫 planning。
    const planningBefore = f.allRows().graph_nodes;
    const first = await call("adopt_content_drift", command(f, existing.drift!.id, spec.node.id));
    expect(f.allRows().graph_nodes).toEqual(planningBefore);
    const approved = await call("approve_ticket_revision", { ticket_revision_id: first.resolution.draft.id });
    expect(approved.ticket.delivery_status).toBe("planned");
    expect(approved.sync_health).toBe("pending");

    // 產品能力變更先走正常 Brief approval；僅根節點對齊時 adoption 必須拒絕 stale 後代。
    const draft = await call("create_product_brief_draft", { project_id: f.project.id, source_idea_id: f.idea.id,
      base_approved_version_id: f.productBrief.version.id,
      brief: { ...f.productBrief.version.brief, product_goal: "Deliver feature plus independent reporting" } });
    await call("approve_product_brief_version", { product_brief_version_id: draft.version.id });
    const stale = command(f, expansion.drift!.id, spec.node.id);
    const before = f.allRows();
    expect((await session.client.callTool({ name: "adopt_content_drift", arguments: stale })).isError).toBe(true);
    expect(f.allRows()).toEqual(before);
    await save({ node_id: milestone.node.id, title: "Stage", document: f.milestoneDocument });
    await save({ node_id: spec.node.id, parent_node_id: milestone.node.id, title: "Spec", document: f.specDocument });
    const second = await call("adopt_content_drift", command(f, expansion.drift!.id, spec.node.id));
    expect(second.resolution.draft.ticket_id).toBe(f.ticket.id);
    expect(second.resolution.draft.review_status).toBe("draft");

    // 獨立能力要另建 Spec/Ticket，client 不將其他 Ticket 候選塞進本指令。
    const reporting = await save({ parent_node_id: milestone.node.id, title: "Independent reporting", document: {
      ...f.specDocument, content: { ...f.specDocument.content, problem_statement: "Need independent report", solution: "Produce report" } } });
    const planned = await call("create_ticket_draft_batch", { project_id: f.project.id,
      source_graph_revision_id: f.currentGraph(), source_node_ids: [reporting.node.id],
      tickets: [{ ...specification(f, reporting.node.id), title: "Produce independent report", scope: ["Report"] }] });
    expect(planned.tickets[0].ticket.id).not.toBe(f.ticket.id);
    expect(readContentDriftResolution(f.ports, separate.drift!.id).resolution).toBeNull();
    expect(f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId).toBe(first.resolution.draft.id);
    expect(f.ports.tickets.findById(f.ticket.id)!.deliveryStatus).toBe("planned");
    expect(f.allRows().result_acceptances).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); await session.close(); }
});
