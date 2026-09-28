// 採用測試共用既有合法外部證據；planning 操作皆走正常 workflow。
import { planeObservationHistoryFixture } from "./plane-observation-history-fixture.js";
import type { TicketSpecInput } from "../application/ticket-workflow.js";

export async function contentDriftAdoptionFixture() {
  const f = await planeObservationHistoryFixture();
  const currentGraph = () => f.ports.projects.findById(f.project.id)!.currentGraphRevisionId!;
  const specification = (extra: Partial<TicketSpecInput> = {}): TicketSpecInput => ({
    title: "  Editorial title  ", userStory: "Selected external wording", scope: ["Feature", "Feature"],
    acceptanceCriteria: ["Works"], nonGoals: [], relatedGraphNodeIds: [f.goal], implementationNotes: [],
    implementationTargets: f.revision.requiredTargets.map(value => ({ repositoryId: value.repository_id, scope: value.scope })), ...extra
  });
  const command = (contentDriftId: string) => ({ contentDriftId, reason: "  採用選定文字  ",
    baseApprovedRevisionId: f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!,
    sourceGraphRevisionId: currentGraph(), specification: specification() });
  const milestoneDocument = { type: "milestone" as const, content: { outcome: "Deliver feature", exit_criteria: ["Feature works"],
    sequence: 1, scope: ["Feature"], non_goals: [] } };
  const specDocument = { type: "spec" as const, content: { problem_statement: "Need feature", solution: "Deliver feature",
    user_stories: ["Use feature"], implementation_decisions: [], testing_decisions: ["Verify feature"], out_of_scope: [], further_notes: [] } };
  function hierarchy() {
    const milestone = f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: currentGraph(),
      title: "Stage", document: milestoneDocument });
    const spec = f.service.planning.save({ projectId: f.project.id, baseGraphRevisionId: currentGraph(), title: "Spec",
      document: specDocument, parentNodeId: milestone.node.id });
    return { milestone, spec };
  }
  function attach(specId: string) {
    const draft = f.service.createTicketRevisionDraft({ ticketId: f.ticket.id,
      baseApprovedRevisionId: f.ports.tickets.findById(f.ticket.id)!.currentApprovedRevisionId!, sourceGraphRevisionId: currentGraph(),
      specification: specification({ sourceSpecId: specId, relatedGraphNodeIds: [] }) });
    return f.service.approveTicketRevision(draft.revision.id).revision;
  }
  function changeBrief() {
    const draft = f.service.createProductBriefDraft({ projectId: f.project.id, sourceIdeaId: f.idea.id,
      baseApprovedVersionId: f.ports.productBriefs.findByProjectId(f.project.id)!.currentApprovedVersionId,
      brief: { ...f.productBrief.version.brief, product_goal: "Deliver expanded capability" } });
    return f.service.approveProductBriefVersion(draft.version.id);
  }
  return { ...f, currentGraph, specification, command, hierarchy, attach, changeBrief, milestoneDocument, specDocument };
}
