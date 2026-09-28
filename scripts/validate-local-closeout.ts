// 僅在新的記憶體 SQLite 回放協定；測試 actor 的接受不代表使用者產品 Acceptance。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProductGraphService } from "../src/application/product-graph-service.js";
import { createMcpServer } from "../src/adapters/mcp/server.js";
import { acceptanceFixture } from "../src/test-support/result-acceptance-fixture.js";

const [repositoryPath, outputPath] = process.argv.slice(2);
assert(repositoryPath && outputPath, "Usage: node --import tsx scripts/validate-local-closeout.ts PRODUCT_REPOSITORY OUTPUT_JSON");
const startedAt = new Date().toISOString();
const productCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).trim();
assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: repositoryPath, encoding: "utf8" }), "");
const actor = { id: "isolated-protocol-reviewer-not-user", displayName: "隔離協定測試 actor，非使用者" };
const fixture = acceptanceFixture();
const target = new ProductGraphService(fixture.ports, { actor });
const server = createMcpServer(target, { profile: "core" });
const client = new Client({ name: "isolated-closeout-proof", version: "1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const calls: unknown[] = [];
async function call(name: string, args: Record<string, unknown>) {
  const started = new Date().toISOString();
  const result = await client.callTool({ name, arguments: args });
  const envelope = result.structuredContent ?? JSON.parse((result.content as { text: string }[])[0]!.text);
  calls.push({ name, arguments: args, started_at: started, completed_at: new Date().toISOString(), response: envelope });
  return envelope as { ok: boolean; data: any; error?: { code: string; details?: { reason?: string } } };
}
async function success(name: string, args: Record<string, unknown>) {
  const response = await call(name, args);
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.data;
}
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  // 準備：沿用既有 fixture 建立上游候選結果，另建立有明確依賴的篩選 Ticket。
  const upstreamResult = fixture.submit().implementationResult;
  const dependent = target.createTicketDraftBatch({ projectId: fixture.project.id,
    sourceGraphRevisionId: fixture.graph.graphRevision.id, sourceNodeIds: [fixture.goal],
    tickets: [{ title: "隔離篩選協定", userStory: "在上游接受後交付篩選", scope: ["協定回放"],
      acceptanceCriteria: ["隔離下游可完成協定"], nonGoals: ["不證明產品 UI 或使用者已接受"],
      relatedGraphNodeIds: [fixture.goal], dependencies: [fixture.ticket.id],
      implementationTargets: [{ repositoryId: fixture.revision.requiredTargets[0]!.repository_id, scope: ["協定"] }],
      implementationNotes: [] }] }).tickets[0]!;
  const approved = target.approveTicketRevision(dependent.revision.id);
  const context = () => success("get_work_context", { ticket_id: dependent.ticket.id });
  const blocked = await context();
  assert.deepEqual(blocked.delivery.blocking_dependency_ids, [fixture.ticket.id]);
  assert.equal(blocked.delivery.next_action, "complete_dependencies");
  assert.equal(blocked.targets[0].accepted_result, null);

  // 操作：測試 actor 接受上游，之後才建立下游計畫；未移除 dependency。
  await success("accept_implementation_result", { implementation_result_id: upstreamResult.id, idempotency_key: "isolated-upstream" });
  const ready = await context();
  assert.deepEqual(ready.delivery.blocking_dependency_ids, []);
  assert.deepEqual(ready.delivery.dependency_ticket_ids, [fixture.ticket.id]);
  assert.equal(ready.delivery.next_action, "implement");
  const draft = await success("create_implementation_brief_draft", {
    implementation_target_id: approved.implementationTargets.targets[0]!.id,
    repo_context: { repository_name: "Repository 0", summary: "使用真實 clean commit，但不改產品",
      file_list: ["src/filter.js"], module_notes: [], baseline_commit_sha: productCommit, has_uncommitted_changes: false },
    brief: { implementation_plan: ["回放 handoff 與交付契約"], suggested_files_to_inspect: ["src/filter.js"],
      test_strategy: ["正確 baseline 通過，錯誤 baseline 拒絕"], risks: [], pr_summary_draft: "隔離驗證" }
  });
  const briefId = draft.implementation_brief.id;
  const stale = await call("start_implementation", { implementation_brief_id: briefId,
    current_repository_state: { commit_sha: "deliberately-wrong-isolated-baseline" } });
  assert.equal(stale.error?.code, "STALE_HANDOFF");
  assert.equal(stale.error?.details?.reason, "repository_baseline_mismatch");
  assert.equal(fixture.ports.implementationBriefs.findById(briefId)?.reviewStatus, "draft");
  const handoff = await success("start_implementation", { implementation_brief_id: briefId,
    current_repository_state: { commit_sha: productCommit } });
  assert.equal(handoff.freshness, "current");
  const result = await success("submit_work_result", { implementation_brief_id: briefId,
    summary: "合成協定 fixture；非產品篩選實作證據或使用者驗收", unfinished_items: [],
    evidence: [{ ref: "protocol", evidence_type: "test_execution", idempotency_key: "isolated-protocol-evidence",
      payload: { schema_version: 1, command: "isolated dependency and baseline assertions (synthetic protocol evidence)",
        status: "passed", exit_code: 0, started_at: startedAt, completed_at: new Date().toISOString() } }],
    criterion_verdicts: approved.revision.specification.acceptance_criteria.map(criterion => ({
      acceptance_criterion_id: criterion.id, verdict: "satisfied", reason: "僅回放協定", evidence_refs: ["protocol"] }))
  });
  const pending = await context();
  assert.equal(pending.delivery.next_action, "review_result");
  assert.equal(pending.targets[0].accepted_result, null);
  assert.equal(pending.targets[0].pending_result.id, result.implementation_result.id);
  const acceptanceArgs = { implementation_result_id: result.implementation_result.id, idempotency_key: "isolated-dependent" };
  const accepted = await success("accept_implementation_result", acceptanceArgs);
  assert.deepEqual(await success("accept_implementation_result", acceptanceArgs), accepted);

  // 驗證：接受歸屬測試 actor，原依賴及 identities 保留，SQLite 完整性正常。
  const done = await context();
  assert.equal(done.delivery.next_action, "done");
  assert.equal(done.revision.id, approved.revision.id);
  assert.deepEqual(done.delivery.dependency_ticket_ids, [fixture.ticket.id]);
  const acceptances = fixture.database.prepare("SELECT implementation_result_id, actor_id FROM result_acceptances").all() as { actor_id: string }[];
  assert.equal(acceptances.length, 2);
  assert(acceptances.every(entry => entry.actor_id === actor.id));
  assert.deepEqual(fixture.database.pragma("foreign_key_check"), []);
  assert.deepEqual(fixture.database.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  const completedAt = new Date().toISOString();
  writeFileSync(outputPath, JSON.stringify({ schema_version: 1, kind: "isolated_protocol_replay",
    database: ":memory:", live_database_accessed: false, product_modified: false, actor,
    fixture_seed_actor: "acceptance-user (existing synthetic fixture only)", product_commit: productCommit,
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    script_sha256: createHash("sha256").update(readFileSync(resolve("scripts/validate-local-closeout.ts"))).digest("hex"),
    started_at: startedAt, completed_at: completedAt, elapsed_ms: Date.parse(completedAt) - Date.parse(startedAt),
    assertions: { blocked_before_acceptance: true, dependency_retained: true, baseline_mismatch_rejected_atomically: true,
      current_handoff: true, pending_not_accepted: true, dependent_accepted_by_test_actor: true, idempotency: true, sqlite_integrity: true },
    acceptance_records: acceptances, calls,
    limitations: ["合成 fixture 不是 live Project", "不是新的無歷史對話", "不將 #104 C4 改成歷史通過", "不證明 UI 或使用者 Acceptance"]
  }, null, 2) + "\n");
} finally {
  await client.close();
  await server.close();
  fixture.database.close();
}
