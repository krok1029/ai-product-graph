import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";

import { ProductGraphService } from "../../application/product-graph-service.js";
import { openDatabase } from "../../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../../infrastructure/sqlite/repositories.js";
import { createFullMcpServer as createMcpServer } from "../../test-support/full-mcp-server.js";
import type { ToolEnvelope } from "./tool-envelope.js";

it("exposes scoped Repository provisioning and business errors through MCP", async () => {
  const database = openDatabase(":memory:");
  const ports = createSqlitePorts(database);
  const target = createMcpServer(new ProductGraphService(ports));
  const client = new Client({ name: "repository-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  async function call(name: string, input: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: input });
    const content = result.content as Array<{ type: string; text: string }>;
    return JSON.parse(content[0]!.text) as ToolEnvelope;
  }
  try {
    await target.connect(serverTransport);
    await client.connect(clientTransport);
    expect((await client.listTools()).tools.map(tool => tool.name))
      .toEqual(expect.arrayContaining(["create_repository", "list_repositories"]));
    const project = (await call("create_project", { name: "Repositories" })).data!.project as { id: string };
    const other = (await call("create_project", { name: "Other" })).data!.project as { id: string };
    const input = { project_id: project.id, slug: "app", name: "App", remote_url: "git@host:org/app.git" };
    const created = await call("create_repository", input);
    expect(created.ok).toBe(true);
    expect(created.audit_log_id).toEqual(expect.any(String));
    expect(created.data!.repository).toMatchObject({ project_id: project.id, slug: "app", root_path: null, remote_url: input.remote_url });
    expect((await call("list_repositories", { project_id: project.id })).data)
      .toEqual({ repositories: [created.data!.repository] });
    expect((await call("list_repositories", { project_id: other.id })).data)
      .toEqual({ repositories: [] });
    expect((await call("create_repository", input)).error?.code).toBe("CONFLICT");
    expect((await call("create_repository", { ...input, slug: " " })).error?.code).toBe("VALIDATION_ERROR");
    expect((await call("create_repository", { ...input, project_id: "missing" })).error?.code).toBe("NOT_FOUND");
    expect((await call("list_repositories", { project_id: "missing" })).error?.code).toBe("NOT_FOUND");
    database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(project.id);
    expect((await call("create_repository", { ...input, slug: "other" })).error?.code).toBe("CONFLICT");
    expect((await call("list_repositories", { project_id: project.id })).error?.code).toBe("CONFLICT");
    expect(ports.auditLog.list().filter(entry => entry.action === "repository.created")).toHaveLength(1);
  } finally {
    await client.close();
    await target.close();
    database.close();
  }
});
