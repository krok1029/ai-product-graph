import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function probeProfile(entrypoint: string, databasePath: string, profile: "core" | "full") {
  const sessions: { pid: number | null; stderr: string; closed: boolean }[] = [];
  async function session<T>(work: (client: Client) => Promise<T>) {
    const client = new Client({ name: "apg-isolated-runtime-verification", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint], stderr: "pipe",
      // 明確隔離 DB 與 actor；不沿用 provider 設定或使用者的 DB 路徑。
      env: { ...getDefaultEnvironment(), AI_PRODUCT_GRAPH_DB_PATH: databasePath,
        AI_PRODUCT_GRAPH_MCP_PROFILE: profile, AI_PRODUCT_GRAPH_ACTOR_ID: "00000000000000000000000003",
        AI_PRODUCT_GRAPH_ACTOR_NAME: "Isolated runtime verification" } });
    const observation = { pid: null as number | null, stderr: "", closed: false };
    sessions.push(observation);
    transport.stderr?.on("data", chunk => { observation.stderr = (observation.stderr + String(chunk)).slice(-8000); });
    try {
      await client.connect(transport, { timeout: 10_000 });
      observation.pid = transport.pid;
      return await work(client);
    } catch (error) {
      throw new Error(`${profile} session failed: ${String(error)}; stderr: ${observation.stderr}`);
    } finally {
      await client.close();
      await transport.close();
      observation.closed = true;
    }
  }
  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 });
    assert(!response.isError, `${name}: ${JSON.stringify(response.content)}`);
    const data = (response.structuredContent as { data?: unknown } | undefined)?.data;
    assert(data && typeof data === "object", `${name}: missing structured data`);
    return data as Record<string, any>;
  }
  async function discover(client: Client) {
    const tools: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 10_000 });
      tools.push(...page.tools.map(tool => tool.name)); cursor = page.nextCursor;
    } while (cursor);
    const prompts: string[] = [];
    const promptsSupported = Boolean(client.getServerCapabilities()?.prompts);
    if (promptsSupported) do {
      const page = await client.listPrompts(cursor ? { cursor } : {}, { timeout: 10_000 });
      prompts.push(...page.prompts.map(prompt => prompt.name)); cursor = page.nextCursor;
    } while (cursor);
    assert(tools.includes("create_project") && tools.includes("get_project"), "Missing project tools");
    assert(tools.includes("create_graph_draft_batch") === (profile === "full"), "Unexpected profile tools");
    assert(promptsSupported === (profile === "full"), "Unexpected profile prompt capability");
    assert(profile !== "full" || prompts.length > 0, "Missing full prompts");
    return { tools: tools.sort(), prompts: prompts.sort(), promptsSupported, server: client.getServerVersion() };
  }
  const initial = await session(async client => {
    const discovery = await discover(client);
    const before = await call(client, "list_projects");
    assert(Array.isArray(before.projects) && before.projects.length === 0, "Database must start empty");
    const { project } = await call(client, "create_project", { name: `Isolated ${profile} runtime fixture` });
    assert(project?.id, "Missing created Project identity");
    return { discovery, project };
  });
  const restart = await session(async client => {
    const discovery = await discover(client);
    assert(JSON.stringify(discovery) === JSON.stringify(initial.discovery), "Discovery changed after restart");
    const loaded = await call(client, "get_project", { project_id: initial.project.id });
    const listed = await call(client, "list_projects");
    assert(JSON.stringify(loaded.project) === JSON.stringify(initial.project), "Project changed after restart");
    assert(listed.projects?.length === 1 && listed.projects[0]?.id === initial.project.id, "Unexpected persisted Projects");
    return { status: "passed", readOnlyToolCalls: ["get_project", "list_projects"], projectId: initial.project.id };
  });
  return { profile, databasePath, initialDiscovery: initial.discovery, restart, sessions };
}
