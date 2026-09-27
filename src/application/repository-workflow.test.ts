import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductGraphService } from "./product-graph-service.js";
import { openDatabase, type SqliteDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";
import type { ApplicationPorts } from "./ports.js";

describe("Repository provisioning", () => {
  let database: SqliteDatabase;
  let ports: ApplicationPorts;
  let target: ProductGraphService;
  let projectId: string;

  beforeEach(() => {
    database = openDatabase(":memory:");
    ports = createSqlitePorts(database);
    target = new ProductGraphService(ports);
    projectId = target.createProject({ name: "Repository tests" }).project.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it("persists normalized metadata with a stable identity and one atomic audit event", () => {
    const result = target.createRepository({
      projectId: ` ${projectId} `,
      name: " App Repository ",
      slug: " app ",
      rootPath: " /path/that/need/not/exist ",
      remoteUrl: " git@example.invalid:org/repo.git "
    });

    expect(result.repository).toEqual({
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      projectId,
      name: "App Repository",
      slug: "app",
      rootPath: "/path/that/need/not/exist",
      remoteUrl: "git@example.invalid:org/repo.git",
      lifecycleStatus: "active",
      createdAt: expect.any(String),
      updatedAt: result.repository.createdAt
    });
    expect(target.listRepositories(projectId).repositories).toEqual([result.repository]);
    expect(ports.auditLog.list().filter(entry => entry.action === "repository.created"))
      .toEqual([{
        id: result.auditLogId,
        projectId,
        actorType: "mcp_client",
        actorId: null,
        action: "repository.created",
        entityType: "repository",
        entityId: result.repository.id,
        beforeSummary: null,
        afterSummary: result.repository,
        metadata: {},
        createdAt: result.repository.createdAt
      }]);
  });

  it("scopes identity and slug uniqueness to a Project without merging by metadata", () => {
    const otherProject = target.createProject({ name: "Other" }).project;
    expect(target.listRepositories(projectId)).toEqual({ repositories: [] });
    const first = target.createRepository({ projectId, slug: "app", name: "App" }).repository;
    const other = target.createRepository({ projectId: otherProject.id, slug: "app", name: "App" }).repository;
    expect(other.id).not.toBe(first.id);
    expect(first.rootPath).toBeNull();
    expect(first.remoteUrl).toBeNull();
    expect(target.listRepositories(projectId).repositories).toEqual([first]);
    expect(target.listRepositories(otherProject.id).repositories).toEqual([other]);
    expect(() => target.createRepository({ projectId, slug: "app", name: "Another" }))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(ports.auditLog.list().filter(entry => entry.action === "repository.created")).toHaveLength(2);
  });

  it("preserves archived identities and reserves their slugs", () => {
    const repository = target.createRepository({ projectId, slug: "app", name: "App" }).repository;
    database.prepare("UPDATE repositories SET lifecycle_status = 'archived' WHERE id = ?").run(repository.id);
    expect(target.listRepositories(projectId).repositories).toEqual([
      { ...repository, lifecycleStatus: "archived" }
    ]);
    expect(() => target.createRepository({ projectId, slug: "app", name: "App" }))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("orders Repository records by creation time and identity", () => {
    let sequence = 0;
    target = new ProductGraphService(ports, {
      idFactory: () => `ordered-${++sequence}`,
      clock: () => new Date("2026-09-27T00:00:00.000Z")
    });
    const first = target.createRepository({ projectId, slug: "z", name: "Z" }).repository;
    const second = target.createRepository({ projectId, slug: "a", name: "A" }).repository;
    expect(target.listRepositories(projectId).repositories).toEqual([first, second]);
  });

  it.each([
    { name: " " }, { slug: " " }, { slug: "Upper" }, { slug: "a--b" },
    { slug: "../app" }, { slug: "a".repeat(81) }, { projectId: " " }
  ])("rejects invalid required fields %j without writes", invalid => {
    expect(() => target.createRepository({ projectId, slug: "app", name: "App", ...invalid }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(target.listRepositories(projectId).repositories).toEqual([]);
    expect(ports.auditLog.list()).toHaveLength(1);
  });

  it("accepts the slug length boundary and normalizes empty optional metadata to null", () => {
    const result = target.createRepository({ projectId, slug: "a".repeat(80), name: "App", rootPath: " ", remoteUrl: null });
    expect(result.repository.rootPath).toBeNull();
    expect(result.repository.remoteUrl).toBeNull();
  });

  it("rejects unknown or archived Project identities on both operations", () => {
    expect(() => target.createRepository({ projectId: "missing", slug: "app", name: "App" }))
      .toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => target.listRepositories("missing"))
      .toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => target.listRepositories(" "))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    database.prepare("UPDATE projects SET lifecycle_status = 'archived' WHERE id = ?").run(projectId);
    expect(() => target.createRepository({ projectId, slug: "app", name: "App" }))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(() => target.listRepositories(projectId))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(ports.repositories.list(projectId)).toEqual([]);
    expect(ports.auditLog.list()).toHaveLength(1);
  });

  it("rolls back Repository insertion when its audit cannot be saved", () => {
    vi.spyOn(ports.auditLog, "append").mockImplementation(() => {
      throw new Error("Audit unavailable");
    });
    expect(() => target.createRepository({ projectId, slug: "app", name: "App" }))
      .toThrow("Audit unavailable");
    expect(target.listRepositories(projectId)).toEqual({ repositories: [] });
    expect(ports.auditLog.list()).toHaveLength(1);
  });
});

it("retains Repository identities, metadata and audit across database reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "repository-provisioning-"));
  const path = join(directory, "graph.sqlite");
  let database = openDatabase(path);
  try {
    const target = new ProductGraphService(createSqlitePorts(database));
    const projectId = target.createProject({ name: "Durability" }).project.id;
    const result = target.createRepository({ projectId, slug: "app", name: "App", rootPath: "/app" });
    database.close();
    database = openDatabase(path);
    const reopenedPorts = createSqlitePorts(database);
    const reopened = new ProductGraphService(reopenedPorts);
    expect(reopened.listRepositories(projectId)).toEqual({ repositories: [result.repository] });
    expect(reopenedPorts.auditLog.list().find(entry => entry.id === result.auditLogId)?.afterSummary)
      .toEqual(result.repository);
    expect(() => reopened.createRepository({ projectId, slug: "app", name: "Retry" }))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
