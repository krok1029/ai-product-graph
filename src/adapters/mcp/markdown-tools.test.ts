import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createMcpServer } from "./server.js";

let database: ReturnType<typeof openDatabase>;
let service: ProductGraphService;
let ports: ReturnType<typeof createSqlitePorts>;
let target: Client;
let server: ReturnType<typeof createMcpServer>;

beforeEach(async () => {
  database = openDatabase(":memory:");
  ports = createSqlitePorts(database);
  service = new ProductGraphService(ports);
  server = createMcpServer(service);
  target = new Client({ name: "markdown-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await target.connect(clientTransport);
});

afterEach(async () => {
  await Promise.allSettled([target?.close(), server?.close()]);
  database?.close();
});

it("exports all brief fields as deterministic review Markdown without writing data", async () => {
  const { version } = setup();
  const before = ports.productBriefVersions.findById(version.id);
  const auditCount = ports.auditLog.list().length;

  const result = await exportBrief(version.id);
  expect(result.ok).toBe(true);
  expect(result.data.suggested_filename).toBe(`product-brief-${version.id}-v1.md`);
  expect(result.data.markdown).toBe([
    "# Product Brief", "", `Version: ${version.id} (1)`, `Project: ${version.projectId}`,
    "Review Status: draft", "", "## Product Goal", "建立產品", "",
    "## Target Users", "- 工程師: 快速規劃", "", "## Pain Points", "- 遺忘: 決策遺失", "",
    "## Core Workflows", "### 規劃", "- 輸入構想", "- 核准", "", "",
    "## MVP Scope", "- 規劃工具", "", "## Non-goals", "- 社群", "",
    "## Success Metrics", "- 完成一次流程", "", "## Risks", "- 規格遺失", "",
    "## Open Questions", "- 下一步？", ""
  ].join("\n"));
  expect(await exportBrief(version.id)).toEqual(result);
  expect(ports.productBriefVersions.findById(version.id)).toEqual(before);
  expect(ports.auditLog.list()).toHaveLength(auditCount);
});

it("exports the requested approved historical version instead of the current pointer", async () => {
  const { projectId, ideaId, version } = setup();
  service.approveProductBriefVersion(version.id);
  const replacement = service.createProductBriefDraft({
    projectId, sourceIdeaId: ideaId, baseApprovedVersionId: version.id,
    brief: { ...version.brief, product_goal: "新的目標" }
  });
  service.approveProductBriefVersion(replacement.version.id);

  const result = await exportBrief(version.id);
  expect(result.data.markdown).toContain("Review Status: approved");
  expect(result.data.markdown).toContain("建立產品");
  expect(result.data.markdown).not.toContain("新的目標");
});

it("preserves empty sections and renders source markup as text", async () => {
  const { projectId, ideaId, version } = setup();
  const empty = service.createProductBriefDraft({
    projectId, sourceIdeaId: ideaId, baseApprovedVersionId: null,
    brief: { ...version.brief, product_goal: "<script>*目標*\n# 文字", target_users: [],
      pain_points: [], core_workflows: [], mvp_scope: [], non_goals: [],
      success_metrics: [], risks: [], open_questions: [] }
  });
  const result = await exportBrief(empty.version.id);
  expect(result.data.markdown).toContain("&lt;script&gt;\\*目標\\*<br>\\# 文字");
  expect(result.data.markdown.match(/- None/g)).toHaveLength(8);
});

it("rejects missing, archived and unsupported artifacts", async () => {
  expect(await exportBrief("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  const { version } = setup();
  database.prepare("UPDATE product_brief_versions SET lifecycle_status = 'archived' WHERE id = ?").run(version.id);
  expect(await exportBrief(version.id)).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  const invalid = await target.callTool({ name: "export_markdown_draft", arguments: {
    entity_type: "project", entity_id: version.id
  } });
  expect(invalid.isError).toBe(true);
});

async function exportBrief(id: string) {
  const result = await target.callTool({ name: "export_markdown_draft", arguments: {
    entity_type: "product_brief_version", entity_id: id
  } });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

function setup() {
  const project = service.createProject({ name: "Markdown" }).project;
  const idea = service.addIdea({ projectId: project.id, content: "想法", source: "test" }).idea;
  const draft = service.createProductBriefDraft({
    projectId: project.id, sourceIdeaId: idea.id, baseApprovedVersionId: null,
    brief: {
      product_goal: "建立產品", target_users: [{ name: "工程師", description: "快速規劃" }],
      pain_points: [{ title: "遺忘", description: "決策遺失" }],
      core_workflows: [{ title: "規劃", steps: ["輸入構想", "核准"] }],
      mvp_scope: ["規劃工具"], non_goals: ["社群"], success_metrics: ["完成一次流程"],
      risks: ["規格遺失"], open_questions: ["下一步？"]
    }
  });
  return { projectId: project.id, ideaId: idea.id, version: draft.version };
}

it("exports a draft Ticket Revision with criterion identities and all repository scopes", async () => {
  const { revision, input, dependency } = setupTicket();
  const before = database.serialize();

  const result = await exportArtifact("ticket_revision", revision.id);

  expect(result.ok).toBe(true);
  expect(result.data.suggested_filename).toBe(`ticket-revision-${revision.id}-r1.md`);
  for (const value of [revision.id, revision.ticketId, revision.projectId,
    revision.sourceGraphRevisionId, revision.ticketDraftBatchId, dependency.ticket.id]) {
    expect(result.data.markdown).toContain(value);
  }
  expect(result.data.markdown).toContain("Review Status: draft");
  expect(result.data.markdown).toContain("Traces To Ticket: " + dependency.ticket.id);
  expect(result.data.markdown).toContain("建立訂單");
  expect(result.data.markdown).toContain("作為買家，我能送出訂單");
  for (const value of [...input.scope, ...input.nonGoals, ...input.implementationNotes,
    ...input.relatedGraphNodeIds, ...input.dependencies]) {
    expect(result.data.markdown).toContain(value);
  }
  for (const criterion of revision.specification.acceptance_criteria) {
    expect(result.data.markdown).toContain(`${criterion.id}: ${criterion.text}`);
  }
  for (const required of revision.requiredTargets) {
    expect(result.data.markdown).toContain(`Repository: ${required.repository_id}`);
    expect(result.data.markdown).toContain(required.scope[0]);
  }
  expect(await exportArtifact("ticket_revision", revision.id)).toEqual(result);
  expect(database.serialize()).toEqual(before);
});

it("exports historical revision membership and title after replacement removes a target", async () => {
  const { revision, input } = setupTicket();
  service.approveTicketRevision(revision.id);
  const replacement = service.createTicketRevisionDraft({
    ticketId: revision.ticketId, baseApprovedRevisionId: revision.id,
    sourceGraphRevisionId: revision.sourceGraphRevisionId,
    specification: { ...input, title: "新版標題", scope: ["新版範圍"],
      implementationTargets: [{ ...input.implementationTargets[0]!, scope: ["新版前端"] }] }
  });
  service.approveTicketRevision(replacement.revision.id);
  const before = database.serialize();

  const historical = await exportArtifact("ticket_revision", revision.id);
  const current = await exportArtifact("ticket_revision", replacement.revision.id);

  expect(historical.data.markdown).toContain("Review Status: approved");
  expect(historical.data.markdown).toContain("建立訂單");
  expect(historical.data.markdown).toContain("後端 API 範圍");
  expect(historical.data.markdown).not.toContain("新版");
  expect(current.data.markdown).toContain("Base Approved Revision: " + revision.id);
  expect(current.data.markdown).toContain("新版前端");
  expect(current.data.markdown).not.toContain("後端 API 範圍");
  expect(database.serialize()).toEqual(before);
});

it("exports immutable Implementation Brief sources despite newer intent and repository metadata", async () => {
  const setup = setupImplementationBrief();
  service.approveImplementationBrief(setup.brief.id);
  const replacement = service.createProductBriefDraft({
    projectId: setup.projectId, sourceIdeaId: setup.ideaId,
    baseApprovedVersionId: setup.version.id,
    brief: { ...setup.version.brief, product_goal: "全新產品意圖" }
  });
  service.approveProductBriefVersion(replacement.version.id);
  database.prepare("UPDATE repositories SET name = ? WHERE id = ?")
    .run("新 Repository 名稱", setup.snapshot.repositoryId);
  const before = database.serialize();

  const result = await exportArtifact("implementation_brief", setup.brief.id);

  expect(result.ok).toBe(true);
  expect(result.data.suggested_filename).toBe(`implementation-brief-${setup.brief.id}.md`);
  for (const value of [setup.brief.id, setup.brief.implementationTargetId,
    setup.revision.id, setup.version.id, setup.snapshot.id, setup.snapshot.repositoryId,
    "Review Status: approved", "建立產品", "建立訂單", "前端介面範圍", "後端 API 範圍",
    "建立表單", "src/order\\.ts", "測試送出流程", "重複請求風險", "新增訂單流程",
    "原始程式碼摘要", "訂單模組", "Baseline Commit SHA: abc123",
    "Has Uncommitted Changes: true", "Dirty State Fingerprint: dirty123",
    "Approvable: true", "Supersedes Implementation Brief: None"]) {
    expect(result.data.markdown).toContain(value);
  }
  expect(result.data.markdown).toContain("Repository Name: Frontend");
  expect(result.data.markdown).toContain(setup.revision.specification.acceptance_criteria[0]!.id);
  expect(result.data.markdown).not.toContain("全新產品意圖");
  expect(result.data.markdown).not.toContain("新 Repository 名稱");
  expect(database.serialize()).toEqual(before);
});

it("exports incomplete draft context as review text without requiring handoff approval", async () => {
  const setup = setupImplementationBrief(false);
  const before = database.serialize();

  const result = await exportArtifact("implementation_brief", setup.brief.id);

  expect(result.ok).toBe(true);
  expect(result.data.markdown).toContain("Review Status: draft");
  expect(result.data.markdown).toContain("Baseline Commit SHA: None");
  expect(result.data.markdown).toContain("Approvable: false");
  expect(result.data.markdown).toContain("&lt;script&gt;\\*計畫\\*<br>\\# 細節");
  expect(result.data.markdown).toContain("## Test Strategy\n- None");
  expect(result.data.markdown).toContain("### File List\n- None");
  expect(database.serialize()).toEqual(before);
});

it.each(["ticket_revision", "implementation_brief"])("rejects missing and archived %s without writes", async entityType => {
  const setup = setupImplementationBrief();
  const id = entityType === "ticket_revision" ? setup.revision.id : setup.brief.id;
  const table = entityType === "ticket_revision" ? "ticket_revisions" : "implementation_briefs";
  database.prepare(`UPDATE ${table} SET lifecycle_status = 'archived' WHERE id = ?`).run(id);
  const before = database.serialize();

  const missing = await exportArtifact(entityType, "missing");
  const archived = await exportArtifact(entityType, id);

  expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(archived).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(database.serialize()).toEqual(before);
});

async function exportArtifact(entityType: string, entityId: string) {
  const result = await target.callTool({ name: "export_markdown_draft", arguments: {
    entity_type: entityType, entity_id: entityId
  } });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

function setupTicket() {
  const base = setup();
  service.approveProductBriefVersion(base.version.id);
  const graph = service.createGraphDraftBatch({
    projectId: base.projectId, sourceProductBriefVersionId: base.version.id,
    baseGraphRevisionId: null, changes: [{ changeId: "goal", operation: "add", entityKind: "node",
      targetId: null, payload: { type: "product_goal", title: "訂單服務" } }]
  });
  const approvedGraph = service.approveGraphDraftBatch(graph.graphDraftBatch.id);
  const front = service.createRepository({ projectId: base.projectId, name: "Frontend", slug: "frontend" }).repository;
  const back = service.createRepository({ projectId: base.projectId, name: "Backend", slug: "backend" }).repository;
  const input = {
    title: "建立訂單", userStory: "作為買家，我能送出訂單", scope: ["訂單輸入"],
    acceptanceCriteria: ["買家能送出訂單", "系統顯示成功訊息"], nonGoals: ["付款"],
    relatedGraphNodeIds: [approvedGraph.applied.addedIds[0]!], dependencies: [] as string[],
    implementationTargets: [{ repositoryId: front.id, scope: ["前端介面範圍"] },
      { repositoryId: back.id, scope: ["後端 API 範圍"] }], implementationNotes: ["保留既有訂單"],
    tracesToTicketId: null as string | null
  };
  const batchInput = { projectId: base.projectId, sourceGraphRevisionId: approvedGraph.graphRevision.id,
    sourceNodeIds: input.relatedGraphNodeIds };
  const dependencyDraft = service.createTicketDraftBatch({ ...batchInput,
    tickets: [{ ...input, title: "建立前置流程" }] });
  const dependency = service.approveTicketRevision(dependencyDraft.tickets[0]!.revision.id);
  input.dependencies = [dependency.ticket.id];
  input.tracesToTicketId = dependency.ticket.id;
  const draft = service.createTicketDraftBatch({ ...batchInput, tickets: [input] });
  return { ...base, input, dependency, revision: draft.tickets[0]!.revision };
}

function setupImplementationBrief(complete = true) {
  const setup = setupTicket();
  const approval = service.approveTicketRevision(setup.revision.id);
  const draft = service.createImplementationBriefDraft({
    implementationTargetId: approval.implementationTargets.targets[0]!.id,
    repoContext: { repositoryName: "Frontend", summary: "原始程式碼摘要",
      fileList: complete ? ["src/order.ts"] : [], moduleNotes: ["訂單模組"],
      baselineCommitSha: complete ? "abc123" : null,
      hasUncommittedChanges: true, dirtyStateFingerprint: complete ? "dirty123" : null },
    brief: { implementationPlan: [complete ? "建立表單" : "<script>*計畫*\n# 細節"],
      suggestedFilesToInspect: ["src/order.ts"], testStrategy: complete ? ["測試送出流程"] : [],
      risks: ["重複請求風險"], prSummaryDraft: "新增訂單流程" }
  });
  return { ...setup, brief: draft.implementationBrief, snapshot: draft.repositoryContextSnapshot };
}
