import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../../infrastructure/sqlite/database.js";

type Identity = { id: string };
type Envelope<T> = { ok: boolean; data: T; audit_log_id?: string };
type Criterion = { id: string; text: string };
type TicketRevision = Identity & { specification: { acceptance_criteria: Criterion[] } };
type Ticket = Identity & { delivery_status: string };
type Acceptance = {
  implementation_result: Identity;
  result_acceptance: Identity;
  ticket: Ticket;
};
type Revocation = { result_revocation: Identity; ticket: Ticket };

let directory: string;
let databasePath: string;
let target: Client;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "apg-stdio-workflow-"));
  databasePath = join(directory, "project.sqlite");
  target = await connect(databasePath);
});

afterEach(async () => {
  await target?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("exposes the real stdio server and persists a Project without fixture writes", async () => {
  // 前置：啟動正式 entrypoint，使用全新的暫存 SQLite。
  const project = await call<{ project: Identity }>("create_project", { name: "Stdio project" });

  // 操作：關閉並重新啟動同一 database 的 server。
  await target.close();
  target = await connect(databasePath);
  const result = await call<{ project: Identity }>("get_project", { project_id: project.project.id });

  // 驗證：identity 保留，JSON-RPC stdout 沒有混入 logging。
  expect(result.project.id).toBe(project.project.id);
  expect((await target.listPrompts()).prompts).toHaveLength(6);
}, 25_000);

it("completes acceptance and revocation through stdio and replays original receipts after restart", async () => {
  // 前置：所有使用者資料都經 MCP 建立，不直接插入 Repository 或其他 fixture。
  const context = await createHandoff();
  const evidenceInput = {
    project_id: context.projectId, repository_id: context.repositoryId,
    evidence_type: "test_execution", idempotency_key: "demo-evidence",
    payload: {
      schema_version: 1, command: "pnpm test", status: "passed", exit_code: 0,
      started_at: "2026-09-27T00:00:00.000Z", completed_at: "2026-09-27T00:00:01.000Z"
    }
  };
  const evidence = await call<{ observed_evidence: Identity; created: boolean }>("record_observed_evidence", evidenceInput);
  expect(evidence.created).toBe(true);
  expect(await call("record_observed_evidence", evidenceInput)).toMatchObject({
    created: false, observed_evidence: { id: evidence.observed_evidence.id }
  });
  const result = await call<{ implementation_result: Identity }>("submit_implementation_result", {
    implementation_brief_id: context.implementationBriefId,
    observed_evidence_ids: [evidence.observed_evidence.id], summary: "Implemented and tested the goal.",
    criterion_verdicts: context.criteria.map(criterion => ({
      acceptance_criterion_id: criterion.id, verdict: "satisfied",
      reason: "The recorded test execution verifies the criterion.", evidence_ids: [evidence.observed_evidence.id]
    })), unfinished_items: []
  });
  const acceptCommand = {
    implementation_result_id: result.implementation_result.id,
    idempotency_key: "demo-acceptance", waivers: []
  };

  // 操作：先接受結果，再明確撤銷當時無效的驗收。
  const accepted = await envelope<Acceptance>("accept_implementation_result", acceptCommand);
  expect(accepted.data.ticket.delivery_status).toBe("done");
  const revokeCommand = {
    result_acceptance_id: accepted.data.result_acceptance.id,
    idempotency_key: "demo-revocation", reason: "The acceptance used evidence from an invalid test setup.",
    next_delivery_status: "in_progress"
  };
  const revoked = await envelope<Revocation>("revoke_result_acceptance", revokeCommand);
  expect(revoked.data.ticket.delivery_status).toBe("in_progress");
  await target.close();
  const firstDomainAudits = inspectStorage();
  target = await connect(databasePath);

  // 驗證：即使業務狀態已改變，重啟後仍回放原始 response／audit identity。
  expect(await envelope("accept_implementation_result", acceptCommand)).toEqual(accepted);
  expect(await envelope("revoke_result_acceptance", revokeCommand)).toEqual(revoked);
  const ticketContext = await call<{ ticket: Ticket }>("get_ticket_context", { ticket_id: context.ticketId });
  expect(ticketContext.ticket.delivery_status).toBe("in_progress");
  for (const [entityType, entityId] of [
    ["product_brief_version", context.productBriefVersionId],
    ["ticket_revision", context.ticketRevisionId],
    ["implementation_brief", context.implementationBriefId]
  ]) {
    expect(await call("export_markdown_draft", { entity_type: entityType, entity_id: entityId }))
      .toMatchObject({ markdown: expect.stringContaining("#"), suggested_filename: expect.stringMatching(/\.md$/) });
  }
  await target.close();
  expect(inspectStorage()).toEqual(firstDomainAudits);
}, 25_000);

async function createHandoff() {
  const project = await call<{ project: Identity }>("create_project", { name: "Complete local demo" });
  const projectId = project.project.id;
  const repository = await call<{ repository: Identity }>("create_repository", {
    project_id: projectId, slug: "app", name: "Demo app"
  });
  const repositoryId = repository.repository.id;
  const idea = await call<{ idea: Identity }>("add_idea", { project_id: projectId, content: "Keep product intent traceable.", source: "demo" });
  expect((await target.getPrompt({ name: "product-brief", arguments: { project_id: projectId, source_idea_id: idea.idea.id } })).messages.length).toBeGreaterThan(0);
  const brief = await call<{ version: Identity }>("create_product_brief_draft", {
    project_id: projectId, source_idea_id: idea.idea.id, base_approved_version_id: null,
    brief: { product_goal: "Trace product intent", target_users: [], pain_points: [], core_workflows: [],
      mvp_scope: ["Local demo"], non_goals: [], success_metrics: [], risks: [], open_questions: [] }
  });
  await call("approve_product_brief_version", { product_brief_version_id: brief.version.id });
  await target.getPrompt({ name: "extract-graph", arguments: { project_id: projectId } });
  const graph = await call<{ graph_draft_batch: Identity }>("create_graph_draft_batch", {
    project_id: projectId, source_product_brief_version_id: brief.version.id, base_graph_revision_id: null,
    changes: [{ change_id: "goal", operation: "add", entity_kind: "node", target_id: null,
      payload: { type: "product_goal", title: "Trace product intent" } }]
  });
  const graphApproval = await call<{ graph_revision: Identity }>("approve_graph_draft_batch", { graph_draft_batch_id: graph.graph_draft_batch.id });
  const graphContext = await call<{ nodes: Identity[] }>("get_graph_context", { project_id: projectId });
  const nodeId = graphContext.nodes[0]!.id;
  await target.getPrompt({ name: "generate-tickets", arguments: { project_id: projectId } });
  const draft = await call<{ tickets: { ticket: Identity; revision: Identity }[] }>("create_ticket_draft_batch", {
    project_id: projectId, source_graph_revision_id: graphApproval.graph_revision.id, source_node_ids: [nodeId],
    tickets: [{ title: "Preserve product context", user_story: "As a planner, I can trace the goal.", scope: ["Trace"],
      acceptance_criteria: ["The goal can be traced."], non_goals: [], related_graph_node_ids: [nodeId],
      implementation_targets: [{ repository_id: repositoryId, scope: ["Trace"] }], implementation_notes: [] }]
  });
  const approved = await call<{ ticket: Identity; revision: TicketRevision; implementation_targets: Identity[] }>("approve_ticket_revision", {
    ticket_revision_id: draft.tickets[0]!.revision.id
  });
  const implementation = await call<{ implementation_brief: Identity }>("create_implementation_brief_draft", {
    implementation_target_id: approved.implementation_targets[0]!.id,
    repo_context: { repository_name: "Demo app", summary: "Client-provided repository context.", file_list: ["src/index.ts"],
      module_notes: [], baseline_commit_sha: "abc123", has_uncommitted_changes: false, dirty_state_fingerprint: null },
    brief: { implementation_plan: ["Preserve context"], suggested_files_to_inspect: ["src/index.ts"],
      test_strategy: ["Run context tests"], risks: [], pr_summary_draft: "Preserve product context." }
  });
  await call("approve_implementation_brief", { implementation_brief_id: implementation.implementation_brief.id });
  expect(await call("get_implementation_handoff", {
    implementation_brief_id: implementation.implementation_brief.id,
    current_repository_state: { commit_sha: "abc123", dirty_state_fingerprint: null }
  })).toMatchObject({ freshness: "current" });
  const resource = await target.readResource({ uri: `product-graph://projects/${projectId}/brief` });
  expect(resource.contents).toHaveLength(1);
  return { projectId, repositoryId, ticketId: approved.ticket.id, ticketRevisionId: approved.revision.id,
    productBriefVersionId: brief.version.id, implementationBriefId: implementation.implementation_brief.id,
    criteria: approved.revision.specification.acceptance_criteria };
}

async function connect(path: string) {
  const client = new Client({ name: "stdio-workflow-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["--import", "tsx", "src/index.ts"],
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), stderr: "pipe",
    env: { ...getDefaultEnvironment(), AI_PRODUCT_GRAPH_DB_PATH: path,
      AI_PRODUCT_GRAPH_ACTOR_ID: "stdio-demo-actor", AI_PRODUCT_GRAPH_ACTOR_NAME: "Demo reviewer" }
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await transport.close();
    throw error;
  }
}

async function envelope<T = Record<string, unknown>>(name: string, args: Record<string, unknown>) {
  const result = await target.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const response = result.structuredContent as Envelope<T>;
  expect(response.ok).toBe(true);
  return response;
}

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>) {
  return (await envelope<T>(name, args)).data;
}

function inspectStorage() {
  // 僅以 SQL 讀取完整性與持久化結果；使用者操作全程透過 MCP。
  const database = openDatabase(databasePath);
  try {
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    for (const [table, count] of [["result_acceptances", 1], ["result_revocations", 1], ["operation_receipts", 2], ["observed_evidence", 1]] as const) {
      expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count });
    }
    return database.prepare(
      "SELECT id, action, entity_id FROM audit_log WHERE entity_type IN ('result_acceptance', 'result_revocation') ORDER BY id"
    ).all();
  } finally {
    database.close();
  }
}
