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
