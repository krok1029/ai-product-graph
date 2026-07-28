import { afterEach, describe, expect, it } from "vitest";

import { ProductGraphService } from "./product-graph-service.js";
import {
  openDatabase,
  type SqliteDatabase
} from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";

let database: SqliteDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("ProductGraphService", () => {
  it("creates a project and records an audit entry", () => {
    const { service, ports } = createTestService();

    const result = service.createProject({
      name: "AI Product Graph",
      description: "MCP-first planning"
    });

    expect(result.project.slug).toBe("ai-product-graph");
    expect(service.listProjects().projects).toHaveLength(1);
    expect(ports.auditLog.list()).toHaveLength(1);
  });

  it("adds an immutable raw idea to an active project", () => {
    const { service, ports } = createTestService();
    const project = service.createProject({ name: "Test Project" });

    const result = service.addIdea({
      projectId: project.project.id,
      content: "Keep the original idea.",
      source: "user"
    });

    expect(service.getIdea(result.idea.id).idea.content).toBe(
      "Keep the original idea."
    );
    expect(service.getProject(project.project.id).counts.ideas).toBe(1);
    expect(ports.auditLog.list()).toHaveLength(2);
  });

  it("generates distinct slugs for projects with the same name", () => {
    const { service } = createTestService();

    const first = service.createProject({ name: "Repeated Name" });
    const second = service.createProject({ name: "Repeated Name" });

    expect(first.project.slug).toBe("repeated-name");
    expect(second.project.slug).toMatch(/^repeated-name-/);
  });
});

function createTestService() {
  database = openDatabase(":memory:");
  const ports = createSqlitePorts(database);
  let id = 0;
  const service = new ProductGraphService(ports, {
    idFactory: () => `01TEST${String(++id).padStart(20, "0")}`,
    clock: () => new Date("2026-07-28T00:00:00.000Z")
  });
  return { service, ports };
}
