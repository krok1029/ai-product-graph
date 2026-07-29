import { afterEach, describe, expect, it } from "vitest";

import { ProductGraphService } from "./product-graph-service.js";
import { ApplicationError } from "../domain/errors.js";
import type { ProductBriefJson } from "../domain/models.js";
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

  it("creates and approves the first Product Brief Version", () => {
    const { service, ports } = createTestService();
    const { projectId, ideaId } = createProjectWithIdea(service);

    const draft = service.createProductBriefDraft({
      projectId,
      sourceIdeaId: ideaId,
      baseApprovedVersionId: null,
      brief: sampleBrief()
    });
    const approval = service.approveProductBriefVersion(draft.version.id);

    expect(draft.version.versionNumber).toBe(1);
    expect(draft.version.reviewStatus).toBe("draft");
    expect(approval.version.reviewStatus).toBe("approved");
    expect(approval.version.approvedByActorId).toBe(TEST_ACTOR_ID);
    expect(approval.productBrief.currentApprovedVersionId).toBe(
      draft.version.id
    );
    expect(approval.productIntentReconciliation.status).toBe("pending");
    expect(ports.auditLog.list()).toHaveLength(4);
  });

  it("archives stale sibling drafts after Product Brief approval", () => {
    const { service, ports } = createTestService();
    const { projectId, ideaId } = createProjectWithIdea(service);
    const first = service.createProductBriefDraft({
      projectId,
      sourceIdeaId: ideaId,
      baseApprovedVersionId: null,
      brief: sampleBrief("First direction")
    });
    const sibling = service.createProductBriefDraft({
      projectId,
      sourceIdeaId: ideaId,
      baseApprovedVersionId: null,
      brief: sampleBrief("Parallel direction")
    });

    const approval = service.approveProductBriefVersion(first.version.id);

    expect(approval.archivedStaleVersionIds).toEqual([sibling.version.id]);
    expect(
      ports.productBriefVersions.findById(sibling.version.id)?.lifecycleStatus
    ).toBe("archived");
    expect(() =>
      service.approveProductBriefVersion(sibling.version.id)
    ).toThrowError(ApplicationError);
    expect(
      ports.productBriefs.findByProjectId(projectId)?.currentApprovedVersionId
    ).toBe(first.version.id);
  });

  it("requires a Product Brief draft to use the current approved base", () => {
    const { service } = createTestService();
    const { projectId, ideaId } = createProjectWithIdea(service);

    expect(() =>
      service.createProductBriefDraft({
        projectId,
        sourceIdeaId: ideaId,
        baseApprovedVersionId: "not-current",
        brief: sampleBrief()
      })
    ).toThrowError(ApplicationError);
  });

  it("creates a replacement Product Brief Version from the approved base", () => {
    const { service, ports } = createTestService();
    const { projectId, ideaId } = createProjectWithIdea(service);
    const first = service.createProductBriefDraft({
      projectId,
      sourceIdeaId: ideaId,
      baseApprovedVersionId: null,
      brief: sampleBrief("Initial direction")
    });
    service.approveProductBriefVersion(first.version.id);

    const replacement = service.createProductBriefDraft({
      projectId,
      sourceIdeaId: ideaId,
      baseApprovedVersionId: first.version.id,
      brief: sampleBrief("Updated direction")
    });
    const approval = service.approveProductBriefVersion(
      replacement.version.id
    );

    expect(replacement.version.versionNumber).toBe(2);
    expect(approval.productBrief.currentApprovedVersionId).toBe(
      replacement.version.id
    );
    expect(
      ports.productBriefVersions.findById(first.version.id)?.lifecycleStatus
    ).toBe("active");
    expect(
      ports.productBriefVersions.findById(first.version.id)?.reviewStatus
    ).toBe("approved");
  });
});

const TEST_ACTOR_ID = "00000000000000000000000002";

function createTestService() {
  database = openDatabase(":memory:");
  const ports = createSqlitePorts(database);
  let id = 0;
  const service = new ProductGraphService(ports, {
    idFactory: () => `01TEST${String(++id).padStart(20, "0")}`,
    clock: () => new Date("2026-07-28T00:00:00.000Z"),
    actor: {
      id: TEST_ACTOR_ID,
      displayName: "Test User"
    }
  });
  return { service, ports };
}

function createProjectWithIdea(service: ProductGraphService) {
  const project = service.createProject({ name: "Brief Test Project" });
  const idea = service.addIdea({
    projectId: project.project.id,
    content: "Turn a raw idea into an approved product brief.",
    source: "test"
  });
  return {
    projectId: project.project.id,
    ideaId: idea.idea.id
  };
}

function sampleBrief(
  productGoal = "Create a traceable planning workflow"
): ProductBriefJson {
  return {
    product_goal: productGoal,
    target_users: [],
    pain_points: [],
    core_workflows: [],
    mvp_scope: [],
    non_goals: [],
    success_metrics: [],
    risks: [],
    open_questions: []
  };
}
