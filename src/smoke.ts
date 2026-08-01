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
    const repository = {
      id: "01SMOKEREPOSITORY000000001",
      projectId: project.project.id,
      slug: "app",
      name: "Smoke App Repository",
      rootPath: null,
      remoteUrl: null,
      lifecycleStatus: "active" as const,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z"
    };
    createSqlitePorts(app.database).repositories.insert(repository);
    const graphNodeId = graphContext.nodes[0]?.id;
    assert(graphNodeId !== undefined, "Expected one GraphNode.");
    const ticketDraft = app.service.createTicketDraftBatch({
      projectId: project.project.id,
      sourceGraphRevisionId: graphApproval.graphRevision.id,
      sourceNodeIds: [graphNodeId],
      tickets: [
        {
          title: "Build smoke ticket workflow",
          userStory:
            "As a planner, I can approve a ticket from graph context.",
          scope: ["Create a ticket revision"],
          acceptanceCriteria: ["The ticket revision can be approved."],
          nonGoals: [],
          relatedGraphNodeIds: [graphNodeId],
          implementationTargets: [
            {
              repositoryId: repository.id,
              scope: ["Smoke path"]
            }
          ],
          implementationNotes: []
        }
      ]
    });
    const ticketRevisionId = ticketDraft.tickets[0]?.revision.id;
    assert(
      ticketRevisionId !== undefined,
      "Expected one Ticket Revision draft."
    );
    const ticketApproval = app.service.approveTicketRevision(
      ticketRevisionId
    );
    const ticketContext = app.service.getTicketContext({
      ticketId: ticketApproval.ticket.id,
      includeMarkdown: true
    });
    const implementationTargetId =
      ticketApproval.implementationTargets.targets[0]?.id;
    assert(
      implementationTargetId !== undefined,
      "Expected one Implementation Target."
    );
    const implementationBriefDraft =
      app.service.createImplementationBriefDraft({
        implementationTargetId,
        repoContext: {
          repositoryName: repository.name,
          summary: "Smoke test repository context.",
          fileList: ["src/smoke.ts"],
          moduleNotes: ["Smoke path exercises the vertical slice."],
          baselineCommitSha: "abc123",
          hasUncommittedChanges: false,
          dirtyStateFingerprint: null
        },
        brief: {
          implementationPlan: ["Keep the smoke path green."],
          suggestedFilesToInspect: ["src/smoke.ts"],
          testStrategy: ["Run the compiled smoke script."],
          risks: ["Fixture drift can hide workflow regressions."],
          prSummaryDraft: "Exercise implementation handoff workflow."
        }
      });
    const implementationBriefApproval =
      app.service.approveImplementationBrief(
        implementationBriefDraft.implementationBrief.id
      );
    const handoff = app.service.getImplementationHandoff({
      implementationBriefId:
        implementationBriefApproval.implementationBrief.id,
      currentRepositoryState: {
        commitSha: "abc123",
        dirtyStateFingerprint: null
      }
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
    assert(
      ticketApproval.revision.reviewStatus === "approved",
      "Ticket Revision should be approved."
    );
    assert(
      ticketContext.relatedNodes.length === 1,
      "Ticket context should include related graph context."
    );
    assert(
      implementationBriefApproval.implementationBrief.reviewStatus ===
        "approved",
      "Implementation Brief should be approved."
    );
    assert(
      handoff.freshness === "current",
      "Implementation handoff should be current."
    );
    assert(auditLog.length === 10, "Expected ten audit entries.");

    console.log(
      JSON.stringify({
        ok: true,
        databasePath,
        projectId: project.project.id,
        ideaId: idea.idea.id,
        productBriefVersionId: productBriefApproval.version.id,
        graphRevisionId: graphApproval.graphRevision.id,
        ticketRevisionId: ticketApproval.revision.id,
        implementationBriefId:
          implementationBriefApproval.implementationBrief.id,
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
