import type { PlaneObservationReadRepository } from "./plane-observation-read-ports.js";
import type { PlaneObservationWriteRepository } from "./plane-observation-ports.js";
import type { SyncMappingTerminationRepository } from "./sync-mapping-termination-ports.js";
import type { ExternalWorkItemWriteRepository } from "./external-work-item-write-ports.js";
import type { PlaneEnrollmentRepository } from "./plane-enrollment-ports.js";
import type { SyncAttemptClaimRepository } from "./sync-attempt-claim-ports.js";
import type { ExternalWorkItemRepository } from "./external-work-item-ports.js";
import type { SyncIntentRepository } from "./sync-intent-ports.js";
import type { ExternalContainerRepository } from "./external-container-ports.js";
import type { Decision, OperationReceipt, ResultRevocation, ResultAcceptance, ResultAcceptanceCriterionOutcome } from "../domain/result-acceptance.js";
import type {
  AuditLogEntry,
  GraphDraftBatch,
  GraphDraftBatchChange,
  GraphEdge,
  GraphNode,
  GraphRevision,
  AcceptanceCriterionVerdict,
  ImplementationBrief,
  ImplementationResult,
  ImplementationTarget,
  Idea,
  LifecycleStatus,
  LocalActor,
  ObservedEvidence,
  Project,
  ProductBrief,
  ProductBriefVersion,
  ProjectCounts,
  Repository,
  RepositoryContextSnapshot,
  Ticket,
  TicketDraftBatch,
  TicketRevision
} from "../domain/models.js";

export interface LocalActorRepository {
  ensure(actor: LocalActor): void;
}

export interface ProjectRepository {
  insert(project: Project): void;
  findById(id: string): Project | null;
  findBySlug(slug: string): Project | null;
  list(): Project[];
  getCounts(projectId: string): ProjectCounts;
  setCurrentProductBrief(
    projectId: string,
    productBriefId: string,
    updatedAt: string
  ): void;
  advanceGraphRevision(
    projectId: string,
    expectedGraphRevisionId: string | null,
    graphRevisionId: string,
    sourceProductBriefVersionId: string,
    updatedAt: string
  ): boolean;
}

export interface IdeaRepository {
  insert(idea: Idea): void;
  findById(id: string): Idea | null;
}

export interface ProductBriefRepository {
  insert(brief: ProductBrief): void;
  findByProjectId(projectId: string): ProductBrief | null;
  updateCurrentApprovedVersion(
    productBriefId: string,
    expectedVersionId: string | null,
    versionId: string,
    updatedAt: string
  ): boolean;
}

export interface ProductBriefVersionRepository {
  insert(version: ProductBriefVersion): void;
  findById(id: string): ProductBriefVersion | null;
  nextVersionNumber(productBriefId: string): number;
  approve(
    versionId: string,
    actorId: string,
    approvedAt: string
  ): void;
  archiveStaleDrafts(
    productBriefId: string,
    exceptVersionId: string,
    currentApprovedVersionId: string,
    archivedAt: string
  ): string[];
}

export interface GraphDraftBatchRepository {
  insert(batch: GraphDraftBatch, changes: GraphDraftBatchChange[]): void;
  findById(id: string): GraphDraftBatch | null;
  listChanges(batchId: string): GraphDraftBatchChange[];
  approve(batchId: string, actorId: string, approvedAt: string): void;
  archiveStaleDrafts(
    projectId: string,
    exceptBatchId: string,
    currentGraphRevisionId: string,
    archivedAt: string
  ): string[];
}

export interface GraphRevisionRepository {
  insert(revision: GraphRevision): void;
  findById(id: string): GraphRevision | null;
  nextSequenceNumber(projectId: string): number;
}

export interface GraphNodeRepository {
  insert(node: GraphNode): void;
  findById(id: string): GraphNode | null;
  findBySlug(projectId: string, slug: string): GraphNode | null;
  list(projectId: string, lifecycleStatus?: LifecycleStatus): GraphNode[];
  update(
    nodeId: string,
    input: {
      title?: string;
      description?: string | null;
      metadata?: Record<string, unknown>;
      sourceRefId: string;
      graphRevisionId: string;
      updatedAt: string;
    }
  ): void;
  archive(nodeId: string, graphRevisionId: string, archivedAt: string): void;
}

export interface GraphEdgeRepository {
  insert(edge: GraphEdge): void;
  findById(id: string): GraphEdge | null;
  list(projectId: string, lifecycleStatus?: LifecycleStatus): GraphEdge[];
  update(
    edgeId: string,
    input: {
      relationType?: GraphEdge["relationType"];
      confidence?: number | null;
      metadata?: Record<string, unknown>;
      graphRevisionId: string;
      updatedAt: string;
    }
  ): void;
  archive(edgeId: string, graphRevisionId: string | null, archivedAt: string): void;
}

export interface RepositoryRepository {
  insert(repository: Repository): void;
  findById(id: string): Repository | null;
  findBySlug(projectId: string, slug: string): Repository | null;
  list(projectId: string): Repository[];
}

export interface TicketDraftBatchRepository {
  insert(batch: TicketDraftBatch): void;
  findById(id: string): TicketDraftBatch | null;
}

export interface TicketRepository {
  listByProjectId(projectId: string): Ticket[];
  insert(ticket: Ticket): void;
  findById(id: string): Ticket | null;
  findBySlug(projectId: string, slug: string): Ticket | null;
  setDeliveryStatus(ticketId: string, status: Ticket["deliveryStatus"], updatedAt: string): void;
  updateCurrentApprovedRevision(
    ticketId: string,
    expectedRevisionId: string | null,
    revisionId: string,
    title: string,
    deliveryStatus: Ticket["deliveryStatus"],
    updatedAt: string
  ): boolean;
}

export interface TicketRevisionRepository {
  insert(
    revision: TicketRevision,
    relatedGraphNodeIds: string[],
    dependencyTicketIds: string[]
  ): void;
  findById(id: string): TicketRevision | null;
  listByTicketId(ticketId: string): TicketRevision[];
  nextRevisionNumber(ticketId: string): number;
  approve(revisionId: string, actorId: string, approvedAt: string): void;
  archiveStaleDrafts(
    ticketId: string,
    exceptRevisionId: string,
    currentApprovedRevisionId: string,
    archivedAt: string
  ): string[];
  listGraphNodeIds(revisionId: string): string[];
  listDependencyTicketIds(revisionId: string): string[];
}

export interface ImplementationTargetRepository {
  insert(target: ImplementationTarget): void;
  findById(id: string): ImplementationTarget | null;
  findActiveByTicketAndRepository(
    ticketId: string,
    repositoryId: string
  ): ImplementationTarget | null;
  listActiveByTicketId(ticketId: string): ImplementationTarget[];
  archive(targetId: string, archivedAt: string): void;
}

export interface RepositoryContextSnapshotRepository {
  insert(snapshot: RepositoryContextSnapshot): void;
  findById(id: string): RepositoryContextSnapshot | null;
}

export interface ImplementationBriefRepository {
  insert(brief: ImplementationBrief): void;
  findById(id: string): ImplementationBrief | null;
  findActiveApprovedByTargetId(
    implementationTargetId: string
  ): ImplementationBrief | null;
  findLatestArchivedApprovedByTargetId(
    implementationTargetId: string
  ): ImplementationBrief | null;
  approve(
    implementationBriefId: string,
    actorId: string,
    approvedAt: string
  ): void;
  archive(implementationBriefId: string, archivedAt: string): void;
}

export interface ObservedEvidenceRepository {
  insert(evidence: ObservedEvidence, canonicalPayloadJson: string): void;
  findById(id: string): ObservedEvidence | null;
  findByProjectIdempotencyKey(
    projectId: string,
    idempotencyKey: string
  ): ObservedEvidence | null;
}

export interface ImplementationResultRepository {
  listVerdicts(resultId: string): AcceptanceCriterionVerdict[];
  listEvidenceIds(resultId: string): string[];
  approve(resultId: string, approvedAt: string): void;
  archive(resultId: string, archivedAt: string): void;
  archiveOtherDrafts(targetId: string, exceptResultId: string, archivedAt: string): string[];
  insert(
    result: ImplementationResult,
    observedEvidenceIds: string[],
    verdicts: AcceptanceCriterionVerdict[]
  ): void;
  findById(id: string): ImplementationResult | null;
  findActiveApprovedByTargetId(
    implementationTargetId: string
  ): ImplementationResult | null;
}

export interface ImplementationArtifactRepository {
  archiveActiveForTicketRevision(
    ticketRevisionId: string,
    archivedAt: string
  ): {
    implementationBriefIds: string[];
    implementationResultIds: string[];
  };
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry): void;
  list(): AuditLogEntry[];
}

export interface TransactionRunner {
  run<T>(work: () => T): T;
}

export interface ResultAcceptanceRepository {
  insert(acceptance: ResultAcceptance): void;
  findById(id: string): ResultAcceptance | null;
  findByResultId(resultId: string): ResultAcceptance | null;
  insertOutcome(outcome: ResultAcceptanceCriterionOutcome): void;
}

export interface ResultRevocationRepository {
  insert(revocation: ResultRevocation): void;
  findByAcceptanceId(acceptanceId: string): ResultRevocation | null;
}

export interface DecisionRepository {
  insert(decision: Decision): void;
  findById(id: string): Decision | null;
}

export interface OperationReceiptRepository {
  insert(receipt: OperationReceipt): void;
  find(projectId: string, actorId: string, operation: OperationReceipt["operationName"], key: string): OperationReceipt | null;
}

export type ApplicationPorts = {
  planeObservationReads: PlaneObservationReadRepository;
  planeObservationWrites: PlaneObservationWriteRepository;
  syncMappingTerminations: SyncMappingTerminationRepository;
  externalWorkItemWrites: ExternalWorkItemWriteRepository;
  planeEnrollment: PlaneEnrollmentRepository;
  syncClaims: SyncAttemptClaimRepository;
  externalWorkItems: ExternalWorkItemRepository;
  syncIntents: SyncIntentRepository;
  externalContainers: ExternalContainerRepository;
  resultAcceptances: ResultAcceptanceRepository;
  resultRevocations: ResultRevocationRepository;
  decisions: DecisionRepository;
  operationReceipts: OperationReceiptRepository;
  localActors: LocalActorRepository;
  projects: ProjectRepository;
  ideas: IdeaRepository;
  productBriefs: ProductBriefRepository;
  productBriefVersions: ProductBriefVersionRepository;
  graphDraftBatches: GraphDraftBatchRepository;
  graphRevisions: GraphRevisionRepository;
  graphNodes: GraphNodeRepository;
  graphEdges: GraphEdgeRepository;
  repositories: RepositoryRepository;
  ticketDraftBatches: TicketDraftBatchRepository;
  tickets: TicketRepository;
  ticketRevisions: TicketRevisionRepository;
  implementationTargets: ImplementationTargetRepository;
  repositoryContextSnapshots: RepositoryContextSnapshotRepository;
  implementationBriefs: ImplementationBriefRepository;
  observedEvidence: ObservedEvidenceRepository;
  implementationResults: ImplementationResultRepository;
  implementationArtifacts: ImplementationArtifactRepository;
  auditLog: AuditLogRepository;
  transactions: TransactionRunner;
};
