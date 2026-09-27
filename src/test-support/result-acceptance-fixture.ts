import { ProductGraphService } from "../application/product-graph-service.js";
import { openDatabase, type SqliteDatabase } from "../infrastructure/sqlite/database.js";
import { createSqlitePorts } from "../infrastructure/sqlite/repositories.js";

export function acceptanceFixture(targetCount = 1) {
  const database: SqliteDatabase = openDatabase(":memory:");
  const ports = createSqlitePorts(database);
  let clockCalls = 0;
  const service = new ProductGraphService(ports, {
    actor: { id: "acceptance-user", displayName: "Reviewer" },
    clock: () => new Date(Date.UTC(2026, 8, 27, 0, 0, clockCalls++))
  });
  const project = service.createProject({ name: "Acceptance" }).project;
  const idea = service.addIdea({ projectId: project.id, content: "Verifiable delivery", source: "test" }).idea;
  const brief = service.createProductBriefDraft({ projectId: project.id, sourceIdeaId: idea.id,
    baseApprovedVersionId: null, brief: { product_goal: "Deliver", target_users: [], pain_points: [],
      core_workflows: [], mvp_scope: [], non_goals: [], success_metrics: [], risks: [], open_questions: [] } });
  service.approveProductBriefVersion(brief.version.id);
  const graph = service.createGraphDraftBatch({ projectId: project.id, baseGraphRevisionId: null,
    sourceProductBriefVersionId: brief.version.id, changes: [{ changeId: "goal", operation: "add", entityKind: "node",
      targetId: null, payload: { type: "product_goal", title: "Deliver" } }] });
  const applied = service.approveGraphDraftBatch(graph.graphDraftBatch.id);
  const goal = applied.applied.addedIds[0]!;
  const repositories = Array.from({ length: targetCount }, (_, index) => service.createRepository({
    projectId: project.id, slug: `repo-${index}`, name: `Repository ${index}`
  }).repository);
  const draft = service.createTicketDraftBatch({ projectId: project.id, sourceGraphRevisionId: applied.graphRevision.id,
    sourceNodeIds: [goal], tickets: [{ title: "Deliver feature", userStory: "As a user, I can verify delivery.",
      scope: ["Feature"], acceptanceCriteria: ["First", "Second", "Third"], nonGoals: [], relatedGraphNodeIds: [goal],
      implementationTargets: repositories.map(repository => ({ repositoryId: repository.id, scope: ["Feature"] })),
      implementationNotes: [] }] });
  const approved = service.approveTicketRevision(draft.tickets[0]!.revision.id);
  const briefs = approved.implementationTargets.targets.map(target => {
    const draft = service.createImplementationBriefDraft({ implementationTargetId: target.id,
      repoContext: { repositoryName: repositories.find(repository => repository.id === target.repositoryId)!.name, summary: "Context", fileList: ["src/app.ts"], moduleNotes: [],
        baselineCommitSha: "abc123", hasUncommittedChanges: false },
      brief: { implementationPlan: ["Implement"], suggestedFilesToInspect: [], testStrategy: ["Verify"], risks: [], prSummaryDraft: "Feature" } });
    return service.approveImplementationBrief(draft.implementationBrief.id).implementationBrief;
  });
  function submit(index = 0, unsatisfied: number[] = [], evidence = true, supersedesImplementationResultId?: string) {
    const target = approved.implementationTargets.targets[index]!;
    const observed = service.recordObservedEvidence({ projectId: project.id, repositoryId: target.repositoryId,
      evidenceType: "test_execution", idempotencyKey: `test-${index}`, payload: {
        schema_version: 1, command: "npm test", status: "passed", exit_code: 0,
        started_at: "2026-09-27T00:00:00.000Z", completed_at: "2026-09-27T00:01:00.000Z"
      } }).observedEvidence;
    return service.submitImplementationResult({ implementationBriefId: briefs[index]!.id,
      supersedesImplementationResultId, observedEvidenceIds: [observed.id], summary: "Implemented", unfinishedItems: [],
      criterionVerdicts: approved.revision.specification.acceptance_criteria.map((criterion, position) => ({
        acceptanceCriterionId: criterion.id, verdict: unsatisfied.includes(position) ? "unsatisfied" : "satisfied",
        reason: "Verified criterion", evidenceIds: evidence ? [observed.id] : []
      })) });
  }
  return { database: database as SqliteDatabase, ports, service, project, idea, productBrief: brief, graph: applied, goal,
    ticket: approved.ticket, revision: approved.revision, briefs, submit, clockCalls: () => clockCalls };
}
