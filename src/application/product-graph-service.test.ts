import { afterEach, describe, expect, it } from "vitest";

import { ProductGraphService } from "./product-graph-service.js";
import { ApplicationError } from "../domain/errors.js";
import type { ProductBriefJson, Repository } from "../domain/models.js";
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

  it("approves a no-op Graph Draft Batch and reconciles product intent", () => {
    const { service, ports } = createTestService();
    const { projectId, approvedVersionId } =
      createApprovedProductBrief(service);

    const draft = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: approvedVersionId,
      reconciliationSummary: "Compared product intent; no changes required.",
      changes: []
    });
    const approval = service.approveGraphDraftBatch(
      draft.graphDraftBatch.id
    );

    expect(draft.isNoopReconciliation).toBe(true);
    expect(approval.graphRevision.sequenceNumber).toBe(1);
    expect(approval.graphRevision.isNoopReconciliation).toBe(true);
    expect(approval.productIntentReconciliation.status).toBe("current");
    expect(
      ports.projects.findById(projectId)?.currentGraphRevisionId
    ).toBe(approval.graphRevision.id);
    expect(service.getGraphContext({ projectId }).nodes).toEqual([]);
  });

  it("atomically adds GraphNodes and a GraphEdge using change references", () => {
    const { service } = createTestService();
    const { projectId, approvedVersionId } =
      createApprovedProductBrief(service);
    const draft = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: approvedVersionId,
      changes: [
        {
          changeId: "goal",
          operation: "add",
          entityKind: "node",
          targetId: null,
          payload: {
            type: "product_goal",
            title: "Trace product intent",
            description: "Keep decisions connected to delivery.",
            metadata: {}
          }
        },
        {
          changeId: "pain",
          operation: "add",
          entityKind: "node",
          targetId: null,
          payload: {
            type: "pain_point",
            title: "Context gets lost",
            metadata: {}
          }
        },
        {
          changeId: "edge",
          operation: "add",
          entityKind: "edge",
          targetId: null,
          payload: {
            source_change_id: "goal",
            target_change_id: "pain",
            relation_type: "solves",
            confidence: 0.9,
            metadata: {}
          }
        }
      ]
    });

    const approval = service.approveGraphDraftBatch(
      draft.graphDraftBatch.id
    );
    const context = service.getGraphContext({ projectId });
    const seedOnly = service.getGraphContext({
      projectId,
      nodeTypes: ["product_goal"],
      maxDepth: 0
    });
    const expanded = service.getGraphContext({
      projectId,
      nodeTypes: ["product_goal"],
      maxDepth: 1
    });

    expect(draft.validation.conflicts).toEqual([]);
    expect(approval.applied.addedIds).toHaveLength(3);
    expect(context.nodes).toHaveLength(2);
    expect(context.edges).toHaveLength(1);
    expect(context.edges[0]?.relationType).toBe("solves");
    expect(seedOnly.nodes).toHaveLength(1);
    expect(seedOnly.edges).toHaveLength(0);
    expect(expanded.nodes).toHaveLength(2);
    expect(expanded.edges).toHaveLength(1);
    expect(service.getProject(projectId).counts.graphNodes).toBe(2);
  });

  it("tracks GraphNode updates and archives with monotonic revisions", () => {
    const { service } = createTestService();
    const { projectId, approvedVersionId } =
      createApprovedProductBrief(service);
    const initial = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: approvedVersionId,
      changes: [
        {
          changeId: "goal",
          operation: "add",
          entityKind: "node",
          targetId: null,
          payload: {
            type: "product_goal",
            title: "Initial goal"
          }
        }
      ]
    });
    const firstApproval = service.approveGraphDraftBatch(
      initial.graphDraftBatch.id
    );
    const nodeId = firstApproval.applied.addedIds[0] as string;
    const update = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: firstApproval.graphRevision.id,
      sourceProductBriefVersionId: approvedVersionId,
      changes: [
        {
          changeId: "update-goal",
          operation: "update",
          entityKind: "node",
          targetId: nodeId,
          payload: { title: "Updated goal" }
        }
      ]
    });
    const secondApproval = service.approveGraphDraftBatch(
      update.graphDraftBatch.id
    );
    const archive = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: secondApproval.graphRevision.id,
      sourceProductBriefVersionId: approvedVersionId,
      changes: [
        {
          changeId: "archive-goal",
          operation: "archive",
          entityKind: "node",
          targetId: nodeId,
          payload: {}
        }
      ]
    });
    const thirdApproval = service.approveGraphDraftBatch(
      archive.graphDraftBatch.id
    );

    expect(secondApproval.graphRevision.sequenceNumber).toBe(2);
    expect(thirdApproval.graphRevision.sequenceNumber).toBe(3);
    expect(
      service.getGraphContext({
        projectId,
        lifecycleStatus: "archived"
      }).nodes[0]?.title
    ).toBe("Updated goal");
  });

  it("archives stale sibling Graph Draft Batches after approval", () => {
    const { service, ports } = createTestService();
    const { projectId, approvedVersionId } =
      createApprovedProductBrief(service);
    const first = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: approvedVersionId,
      reconciliationSummary: "First comparison.",
      changes: []
    });
    const sibling = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: approvedVersionId,
      reconciliationSummary: "Parallel comparison.",
      changes: []
    });

    const approval = service.approveGraphDraftBatch(
      first.graphDraftBatch.id
    );

    expect(approval.archivedStaleBatchIds).toEqual([
      sibling.graphDraftBatch.id
    ]);
    expect(
      ports.graphDraftBatches.findById(sibling.graphDraftBatch.id)
        ?.lifecycleStatus
    ).toBe("archived");
    expect(() =>
      service.approveGraphDraftBatch(sibling.graphDraftBatch.id)
    ).toThrowError(ApplicationError);
  });

  it("blocks Graph Draft Batch approval when node identity is ambiguous", () => {
    const { service } = createTestService();
    const { projectId, approvedVersionId } =
      createApprovedProductBrief(service);
    const draft = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: approvedVersionId,
      changes: [
        {
          changeId: "goal-1",
          operation: "add",
          entityKind: "node",
          targetId: null,
          payload: { type: "product_goal", title: "Same identity" }
        },
        {
          changeId: "goal-2",
          operation: "add",
          entityKind: "node",
          targetId: null,
          payload: { type: "product_goal", title: "Same identity" }
        }
      ]
    });

    expect(draft.validation.conflicts).toHaveLength(1);
    expect(() =>
      service.approveGraphDraftBatch(draft.graphDraftBatch.id)
    ).toThrowError(ApplicationError);
    expect(service.getProject(projectId).project.currentGraphRevisionId).toBe(
      null
    );
  });

  it("rejects a Graph Draft Batch after its Product Brief source is superseded", () => {
    const { service, ports } = createTestService();
    const { projectId, ideaId, approvedVersionId } =
      createApprovedProductBrief(service);
    const graphDraft = service.createGraphDraftBatch({
      projectId,
      baseGraphRevisionId: null,
      sourceProductBriefVersionId: approvedVersionId,
      reconciliationSummary: "Compared the original version.",
      changes: []
    });
    const replacement = service.createProductBriefDraft({
      projectId,
      sourceIdeaId: ideaId,
      baseApprovedVersionId: approvedVersionId,
      brief: sampleBrief("Superseding direction")
    });
    service.approveProductBriefVersion(replacement.version.id);

    expect(() =>
      service.approveGraphDraftBatch(graphDraft.graphDraftBatch.id)
    ).toThrowError(ApplicationError);
    expect(ports.projects.findById(projectId)?.currentGraphRevisionId).toBe(
      null
    );
  });

  it("creates and approves a Ticket Revision with an Implementation Target", () => {
    const { service, ports } = createTestService();
    const graph = createApprovedGraphWithGoal(service);
    const repository = seedRepository(ports, graph.projectId);

    const draft = service.createTicketDraftBatch({
      projectId: graph.projectId,
      sourceGraphRevisionId: graph.graphRevisionId,
      sourceNodeIds: [graph.goalNodeId],
      tickets: [
        sampleTicketInput(graph.goalNodeId, repository.id)
      ]
    });
    const ticketItem = draft.tickets[0];
    const approval = service.approveTicketRevision(
      ticketItem?.revision.id ?? ""
    );
    const context = service.getTicketContext({
      ticketId: approval.ticket.id,
      includeMarkdown: true
    });

    expect(draft.ticketDraftBatch.sourceGraphRevisionId).toBe(
      graph.graphRevisionId
    );
    expect(ticketItem?.revision.reviewStatus).toBe("draft");
    expect(approval.revision.reviewStatus).toBe("approved");
    expect(approval.ticket.currentApprovedRevisionId).toBe(
      approval.revision.id
    );
    expect(approval.ticket.deliveryStatus).toBe("planned");
    expect(approval.implementationTargets.targets).toHaveLength(1);
    expect(approval.implementationTargets.targets[0]?.identityAction).toBe(
      "created"
    );
    expect(context.relatedNodes[0]?.id).toBe(graph.goalNodeId);
    expect(context.markdown).toContain("## Acceptance Criteria");
    expect(service.getProject(graph.projectId).counts.tickets).toBe(1);
  });

  it("creates a replacement Ticket Revision that reuses active targets", () => {
    const { service, ports } = createTestService();
    const graph = createApprovedGraphWithGoal(service);
    const repository = seedRepository(ports, graph.projectId);
    const draft = service.createTicketDraftBatch({
      projectId: graph.projectId,
      sourceGraphRevisionId: graph.graphRevisionId,
      sourceNodeIds: [graph.goalNodeId],
      tickets: [sampleTicketInput(graph.goalNodeId, repository.id)]
    });
    const firstApproval = service.approveTicketRevision(
      draft.tickets[0]?.revision.id ?? ""
    );
    const replacement = service.createTicketRevisionDraft({
      ticketId: firstApproval.ticket.id,
      baseApprovedRevisionId: firstApproval.revision.id,
      sourceGraphRevisionId: graph.graphRevisionId,
      specification: {
        ...sampleTicketInput(graph.goalNodeId, repository.id),
        title: "Build fast preset timer controls"
      }
    });
    const approval = service.approveTicketRevision(replacement.revision.id);

    expect(replacement.revision.revisionNumber).toBe(2);
    expect(
      replacement.proposedImplementationTargets[0]?.identityAction
    ).toBe("reuse");
    expect(approval.implementationTargets.targets[0]?.identityAction).toBe(
      "reused"
    );
    expect(approval.ticket.currentApprovedRevisionId).toBe(
      replacement.revision.id
    );
    expect(
      ports.ticketRevisions.findById(firstApproval.revision.id)?.reviewStatus
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

function createApprovedProductBrief(service: ProductGraphService) {
  const { projectId, ideaId } = createProjectWithIdea(service);
  const draft = service.createProductBriefDraft({
    projectId,
    sourceIdeaId: ideaId,
    baseApprovedVersionId: null,
    brief: sampleBrief()
  });
  const approval = service.approveProductBriefVersion(draft.version.id);
  return {
    projectId,
    ideaId,
    approvedVersionId: approval.version.id
  };
}

function createApprovedGraphWithGoal(service: ProductGraphService) {
  const { projectId, approvedVersionId } =
    createApprovedProductBrief(service);
  const draft = service.createGraphDraftBatch({
    projectId,
    baseGraphRevisionId: null,
    sourceProductBriefVersionId: approvedVersionId,
    changes: [
      {
        changeId: "goal",
        operation: "add",
        entityKind: "node",
        targetId: null,
        payload: {
          type: "product_goal",
          title: "Ship a focused timer MVP"
        }
      }
    ]
  });
  const approval = service.approveGraphDraftBatch(
    draft.graphDraftBatch.id
  );
  return {
    projectId,
    graphRevisionId: approval.graphRevision.id,
    goalNodeId: approval.applied.addedIds[0] as string
  };
}

function seedRepository(
  ports: ReturnType<typeof createSqlitePorts>,
  projectId: string
): Repository {
  const repository: Repository = {
    id: "01TESTREPOSITORY0000000001",
    projectId,
    slug: "app",
    name: "App Repository",
    rootPath: null,
    remoteUrl: null,
    lifecycleStatus: "active",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z"
  };
  ports.repositories.insert(repository);
  return repository;
}

function sampleTicketInput(goalNodeId: string, repositoryId: string) {
  return {
    title: "Build preset countdown controls",
    userStory:
      "As a workout user, I can start a 30 second or 1 minute countdown quickly.",
    scope: ["Add 30 second preset", "Add 1 minute preset"],
    acceptanceCriteria: [
      "A user can start a 30 second countdown in one tap.",
      "A user can start a 1 minute countdown in one tap."
    ],
    nonGoals: ["Custom workout plans"],
    relatedGraphNodeIds: [goalNodeId],
    implementationTargets: [
      {
        repositoryId,
        scope: ["Timer UI and countdown state"]
      }
    ],
    implementationNotes: ["Keep controls usable on mobile."]
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
