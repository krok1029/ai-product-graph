import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "./app.js";
import { createSqlitePorts } from "./infrastructure/sqlite/repositories.js";

const directory = mkdtempSync(join(tmpdir(), "ai-product-graph-smoke-"));
const databasePath = join(directory, "smoke.sqlite");

try {
  const app = createApp({
    databasePath,
    actorId: "00000000000000000000000003",
    actorDisplayName: "Smoke Test User"
  });
  try {
    const project = app.service.createProject({
      name: "Smoke Test Project",
      description: "Phase 1A smoke test"
    });
    const idea = app.service.addIdea({
      projectId: project.project.id,
      content: "Validate the first vertical slice.",
      source: "smoke"
    });
    const projects = app.service.listProjects();
    const loadedIdea = app.service.getIdea(idea.idea.id);
    const productBriefDraft = app.service.createProductBriefDraft({
      projectId: project.project.id,
      sourceIdeaId: idea.idea.id,
      baseApprovedVersionId: null,
      brief: {
        product_goal: "Validate the Product Brief workflow.",
        target_users: [],
        pain_points: [],
        core_workflows: [],
        mvp_scope: ["Create and approve a Product Brief Version."],
        non_goals: [],
        success_metrics: ["The smoke test completes."],
        risks: [],
        open_questions: []
      }
    });
    const productBriefApproval = app.service.approveProductBriefVersion(
      productBriefDraft.version.id
    );
    const graphDraft = app.service.createGraphDraftBatch({
      projectId: project.project.id,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: productBriefApproval.version.id,
      changes: [
        {
          changeId: "goal",
          operation: "add",
          entityKind: "node",
          targetId: null,
          payload: {
            type: "product_goal",
            title: "Validate the Graph workflow."
          }
        }
      ]
    });
    const graphApproval = app.service.approveGraphDraftBatch(
      graphDraft.graphDraftBatch.id
    );
    const graphContext = app.service.getGraphContext({
      projectId: project.project.id
    });
    const auditLog = createSqlitePorts(app.database).auditLog.list();

    assert(projects.projects.length === 1, "Expected one project.");
    assert(
      loadedIdea.idea.projectId === project.project.id,
      "Idea should belong to the created project."
    );
    assert(
      productBriefApproval.version.reviewStatus === "approved",
      "Product Brief Version should be approved."
    );
    assert(
      productBriefApproval.productIntentReconciliation.status === "pending",
      "Product intent reconciliation should be pending."
    );
    assert(
      graphApproval.productIntentReconciliation.status === "current",
      "Product intent reconciliation should be current."
    );
    assert(graphContext.nodes.length === 1, "Expected one GraphNode.");
    assert(auditLog.length === 6, "Expected six audit entries.");

    console.log(
      JSON.stringify({
        ok: true,
        databasePath,
        projectId: project.project.id,
        ideaId: idea.idea.id,
        productBriefVersionId: productBriefApproval.version.id,
        graphRevisionId: graphApproval.graphRevision.id,
        auditLogEntries: auditLog.length
      })
    );
  } finally {
    app.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
