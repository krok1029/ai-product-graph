// 用 timer 控制情境比較完整與精簡介面；只操作暫存 SQLite，不重跑或修改使用者的計時器。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../../infrastructure/sqlite/database.js";

it("replays timer controls through both profiles with 9 versus 4 delivery calls and durable acceptance", async () => {
  const classic = await replay("full");
  const core = await replay("core");
  expect(classic.calls).toBe(9);
  expect(core.calls).toBe(4);
  expect(core.counts).toEqual(classic.counts);
  expect(core.counts).toEqual({ briefs: 1, evidence: 4, results: 1, acceptances: 1 });
}, 30_000);

async function replay(profile: "core" | "full") {
  const directory = mkdtempSync(join(tmpdir(), "apg-timer-profile-"));
  const databasePath = join(directory, "project.sqlite");
  let client = await connect();
  let calls = 0;
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toHaveLength(profile === "core" ? 23 : 46);
    const project = (await call("create_project", { name: "輕運動計時器：暫存流程回放" })).project;
    const repository = (await call("create_repository", { project_id: project.id, slug: "timer", name: "Timer" })).repository;
    const idea = (await call("add_idea", { project_id: project.id, content: "共用開始、暫停、重設控制", source: "isolated protocol fixture" })).idea;
    const brief = await call("create_product_brief_draft", {
      project_id: project.id, source_idea_id: idea.id, base_approved_version_id: null,
      brief: { product_goal: "輕運動計時器", target_users: [], pain_points: [], core_workflows: [], mvp_scope: ["共用控制"],
        non_goals: ["本測試不實作或重新驗證計時器 UI"], success_metrics: [], risks: [], open_questions: [] }
    });
    await call("approve_product_brief_version", { product_brief_version_id: brief.version.id });
    let nodeId: string; let revisionId: string;
    if (profile === "full") {
      const graph = await call("create_graph_draft_batch", {
        project_id: project.id, source_product_brief_version_id: brief.version.id, base_graph_revision_id: null,
        changes: [{ change_id: "controls", operation: "add", entity_kind: "node", target_id: null,
          payload: { type: "product_goal", title: "用共用控制降低運動計時操作負擔" } }]
      });
      const applied = await call("approve_graph_draft_batch", { graph_draft_batch_id: graph.graph_draft_batch.id });
      nodeId = applied.applied.added_ids[0]; revisionId = applied.graph_revision.id;
    } else {
      const graph = await call("get_graph_context", { project_id: project.id });
      const milestone = await call("save_planning_node", { project_id: project.id, base_graph_revision_id: graph.graph_revision_id,
        change: { operation: "save", title: "可用計時器", document: { type: "milestone", content: {
          outcome: "可完成一次計時", exit_criteria: ["控制可驗證"], sequence: 1, scope: ["控制"], non_goals: [] } } } });
      const spec = await call("save_planning_node", { project_id: project.id, base_graph_revision_id: milestone.graph_revision.id,
        change: { operation: "save", title: "共用控制規格", parent_node_id: milestone.node.id, document: { type: "spec", content: {
          problem_statement: "缺乏控制", solution: "提供共用控制", user_stories: ["使用者可暫停"], implementation_decisions: [],
          testing_decisions: ["驗證控制結果"], out_of_scope: [], further_notes: [] } } } });
      nodeId = spec.node.id; revisionId = spec.graph_revision.id;
    }
    const tickets = await call("create_ticket_draft_batch", {
      project_id: project.id, source_graph_revision_id: revisionId, source_node_ids: [nodeId],
      tickets: [{ ...(profile === "core" ? { source_spec_id: nodeId } : {}), title: "開始、暫停、重設", user_story: "使用者可以操作兩種計時模式", scope: ["共用控制"],
        acceptance_criteria: ["初始停止", "暫停後可繼續", "重設停止舊模式"], non_goals: [], related_graph_node_ids: [nodeId],
        implementation_targets: [{ repository_id: repository.id, scope: ["控制狀態"] }], implementation_notes: [] }]
    });
    const ticket = await call("approve_ticket_revision", { ticket_revision_id: tickets.tickets[0].revision.id });
    const context = await call("get_work_context", { ticket_id: ticket.ticket.id });
    expect(context.targets[0].repository.id).toBe(repository.id);

    // 操作：比較相同已核准 Ticket 的交付段，包含一份計畫、四份 evidence 與一次接受。
    calls = 0;
    const implementation = await call("create_implementation_brief_draft", {
      implementation_target_id: ticket.implementation_targets[0].id,
      repo_context: { repository_name: "Timer", summary: "Isolated fixture baseline", file_list: ["src/session.ts"],
        module_notes: [], baseline_commit_sha: "fixture-baseline", has_uncommitted_changes: false },
      brief: { implementation_plan: ["實作共用控制"], suggested_files_to_inspect: ["src/session.ts"],
        test_strategy: ["控制狀態驗證"], risks: [], pr_summary_draft: "共用控制" }
    });
    const briefId = implementation.implementation_brief.id;
    const state = { implementation_brief_id: briefId, current_repository_state: { commit_sha: "fixture-baseline" } };
    if (profile === "full") {
      await call("approve_implementation_brief", { implementation_brief_id: briefId });
      expect((await call("get_implementation_handoff", state)).freshness).toBe("current");
    } else {
      expect((await call("start_implementation", state)).freshness).toBe("current");
    }
    const evidence = Array.from({ length: 4 }, (_, n) => ({
      ref: `e${n}`, evidence_type: "test_execution", idempotency_key: `timer-check-${n}`,
      payload: { schema_version: 1, command: `fixture-control-check-${n}`, status: "passed", exit_code: 0,
        started_at: "2026-09-27T00:00:00.000Z", completed_at: "2026-09-27T00:01:00.000Z" }
    }));
    const verdicts = ticket.revision.specification.acceptance_criteria.map((criterion: { id: string }, n: number) => ({
      acceptance_criterion_id: criterion.id, verdict: "satisfied", reason: `對應控制情境 fixture ${n}`
    }));
    let result;
    if (profile === "full") {
      const ids = [];
      for (const { ref: _ref, ...entry } of evidence) {
        ids.push((await call("record_observed_evidence", { project_id: project.id, repository_id: repository.id, ...entry })).observed_evidence.id);
      }
      result = await call("submit_implementation_result", {
        implementation_brief_id: briefId, observed_evidence_ids: ids, summary: "Fixture controls delivery",
        criterion_verdicts: verdicts.map((v: object, n: number) => ({ ...v, evidence_ids: [ids[n]] }))
      });
    } else {
      result = await call("submit_work_result", {
        implementation_brief_id: briefId, evidence, summary: "Fixture controls delivery",
        criterion_verdicts: verdicts.map((v: object, n: number) => ({ ...v, evidence_refs: [`e${n}`] }))
      });
    }
    expect(result.implementation_result.review_status).toBe("draft");
    const acceptCommand = { implementation_result_id: result.implementation_result.id, idempotency_key: "timer-accept" };
    const accepted = await call("accept_implementation_result", acceptCommand);
    expect(accepted.ticket.delivery_status).toBe("done");
    const deliveryCalls = calls;
    await client.close();
    client = await connect();
    expect(await call("accept_implementation_result", acceptCommand)).toEqual(accepted);
    expect((await call("get_work_context", { ticket_id: ticket.ticket.id })).targets[0].accepted_result.id).toBe(result.implementation_result.id);
    const database = openDatabase(databasePath);
    try {
      expect(database.pragma("foreign_key_check")).toEqual([]);
      const count = (table: string) => (database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
      return { calls: deliveryCalls, counts: { briefs: count("implementation_briefs"), evidence: count("observed_evidence"),
        results: count("implementation_results"), acceptances: count("result_acceptances") } };
    } finally { database.close(); }
  } finally { await client.close(); rmSync(directory, { recursive: true, force: true }); }

  async function connect() {
    const next = new Client({ name: "timer-profile-replay", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", resolve("src/index.ts")], stderr: "pipe",
      env: { ...getDefaultEnvironment(), AI_PRODUCT_GRAPH_DB_PATH: databasePath,
        ...(profile === "full" ? { AI_PRODUCT_GRAPH_MCP_PROFILE: "full" } : {}) }
    });
    try { await next.connect(transport); return next; } catch (error) { await transport.close(); throw error; }
  }
  async function call(name: string, args: Record<string, unknown>) {
    calls++;
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    return response.structuredContent!.data as any;
  }
}
