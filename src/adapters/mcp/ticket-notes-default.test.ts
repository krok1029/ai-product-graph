import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { createFullMcpServer as createMcpServer } from "../../test-support/full-mcp-server.js";

describe.each(["initial batch", "replacement revision"] as const)("%s optional notes through MCP", mode => {
  let fixture: ReturnType<typeof acceptanceFixture>;
  let server: ReturnType<typeof createMcpServer>;
  let target: Client;

  beforeEach(async () => {
    fixture = acceptanceFixture();
    server = createMcpServer(fixture.service);
    target = new Client({ name: "ticket-notes-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await target.connect(clientTransport);
  });

  afterEach(async () => {
    await target.close();
    await server.close();
    fixture.database.close();
  });

  function command(notes: Record<string, unknown>) {
    const specification = {
      title: "Draft with optional notes",
      user_story: "As a user, I can omit implementation notes.",
      scope: ["Optional notes"],
      acceptance_criteria: ["Draft persists normalized notes"],
      non_goals: [],
      related_graph_node_ids: [fixture.goal],
      implementation_targets: fixture.revision.requiredTargets,
      ...notes
    };
    return mode === "initial batch"
      ? { name: "create_ticket_draft_batch", arguments: {
          project_id: fixture.project.id,
          source_graph_revision_id: fixture.graph.graphRevision.id,
          source_node_ids: [fixture.goal], tickets: [specification]
        } }
      : { name: "create_ticket_revision_draft", arguments: {
          ticket_id: fixture.ticket.id,
          base_approved_revision_id: fixture.revision.id,
          source_graph_revision_id: fixture.graph.graphRevision.id,
          specification
        } };
  }

  it.each([
    { label: "omitted", input: {}, expected: [] },
    { label: "explicit empty", input: { implementation_notes: [] }, expected: [] },
    { label: "explicit normalized", input: { implementation_notes: [" Inspect module ", "Add tests", "Inspect module"] },
      expected: ["Inspect module", "Add tests"] }
  ])("persists $label notes without changing approved state", async ({ input, expected }) => {
    // 準備：保留既有核准內容，確認新增 draft 不造成隱含核准。
    const originalTicket = fixture.ports.tickets.findById(fixture.ticket.id);
    const originalRevision = fixture.ports.ticketRevisions.findById(fixture.revision.id);

    const response = await target.callTool(command(input));

    expect(response.isError).not.toBe(true);
    type Revision = { id: string; specification: { implementation_notes: string[] }; review_status: string };
    const envelope = response.structuredContent as {
      ok: boolean; data: { revision: Revision; tickets: { revision: Revision }[] }
    };
    expect(envelope.ok).toBe(true);
    const revision = mode === "initial batch" ? envelope.data.tickets[0]!.revision : envelope.data.revision;
    expect(revision.review_status).toBe("draft");
    expect(revision.specification.implementation_notes).toEqual(expected);
    expect(fixture.ports.ticketRevisions.findById(revision.id)?.specification.implementation_notes).toEqual(expected);
    expect(fixture.ports.tickets.findById(fixture.ticket.id)).toEqual(originalTicket);
    expect(fixture.ports.ticketRevisions.findById(fixture.revision.id)).toEqual(originalRevision);
  });

  it.each([
    { label: "null", value: null },
    { label: "scalar string", value: "note" },
    { label: "non-string item", value: [123] },
    { label: "blank item", value: ["   "] }
  ])("rejects $label notes without draft or audit writes", async ({ value }) => {
    // 準備：比較已提交資料，避免把 transaction rollback 的暫時寫入算成持久化副作用。
    const counts = fixture.database.prepare(`SELECT
      (SELECT COUNT(*) FROM tickets) AS tickets,
      (SELECT COUNT(*) FROM ticket_revisions) AS revisions,
      (SELECT COUNT(*) FROM ticket_draft_batches) AS batches,
      (SELECT COUNT(*) FROM audit_log) AS audits`);
    const before = counts.get();

    const response = await target.callTool(command({ implementation_notes: value }));

    expect(response.isError).toBe(true);
    expect(response.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.stringContaining("implementation_notes") })
    ]));
    expect(counts.get()).toEqual(before);
    expect(fixture.ports.ticketRevisions.findById(fixture.revision.id)).toEqual(fixture.revision);
    expect(fixture.ports.tickets.findById(fixture.ticket.id)).toEqual(fixture.ticket);
  });
});
