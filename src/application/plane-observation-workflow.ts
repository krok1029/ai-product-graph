import { ulid } from "ulid";
import { ApplicationError } from "../domain/errors.js";
import type { PlaneObservation } from "../domain/plane-observation.js";
import { MappingSyncReads } from "./mapping-sync-reads.js";
import { hashJson, planeExportPayload } from "./plane-export-payload.js";
import type { PlaneManagedContentPort, PlaneObservationProviderPort, PlaneObserveOutcome } from "./plane-observation-ports.js";
import { record, unknownObservation, validateChanges, validateObservation } from "./plane-observation-validation.js";
import type { PlaneItemObservation } from "./plane-provider-port.js";
import type { ApplicationPorts } from "./ports.js";

export type PlaneObservationOptions = {
  actor?: { id: string; displayName: string };
  clock?: () => Date;
  idFactory?: () => string;
};

export class PlaneObservationWorkflow {
  private readonly actor: NonNullable<PlaneObservationOptions["actor"]>;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly ports: ApplicationPorts, private readonly provider: PlaneObservationProviderPort,
    private readonly managedContent: PlaneManagedContentPort, options: PlaneObservationOptions = {}) {
    this.actor = options.actor ?? { id: "00000000000000000000000001", displayName: "Local User" };
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? ulid;
  }

  async observe(mappingId: string): Promise<PlaneObserveOutcome> {
    if (typeof mappingId !== "string" || !mappingId.trim()) throw new ApplicationError("VALIDATION_ERROR", "Mapping ID is required.");
    const before = this.ports.transactions.run(() => this.context(mappingId));
    let observed: PlaneItemObservation;
    try {
      // GET 在 transaction 外執行；失敗讀取不建立 actor、audit 或 outbound attempt。
      const outcome = record(await this.provider.readKnownItem({ container: structuredClone(before.container), externalId: before.item.externalId }));
      if (outcome?.status === "unknown") return unknownObservation(outcome.error);
      if (outcome?.status !== "observed") return unknownObservation();
      observed = validateObservation(outcome.item, before.item.externalId, before.container.containerIdentity);
    } catch { return unknownObservation({ code: "PLANE_TRANSPORT_ERROR" }); }
    const capturedAt = this.clock().toISOString();
    try { return this.capture(mappingId, before.identity, observed, capturedAt); }
    catch (error) {
      if (error instanceof InvalidObservation) return unknownObservation();
      throw error;
    }
  }

  private capture(mappingId: string, identity: string, observed: PlaneItemObservation, capturedAt: string) {
    return this.ports.transactions.run(() => {
      const now = this.clock().toISOString();
      // 先取得 writer lock，再讀取 commit-time approved revision；任何失敗都會回滾 actor。
      this.ports.localActors.ensure({ ...this.actor, createdAt: now, updatedAt: now });
      const current = this.context(mappingId);
      if (current.identity !== identity) throw new ApplicationError("CONFLICT", "Mapping identity changed during observation.");
      const payload = planeExportPayload(current.revision);
      let changes: ReturnType<PlaneManagedContentPort["compare"]>;
      try {
        changes = validateChanges(this.managedContent.compare({ expected: { container: current.container,
          idempotencyKey: current.createRequest.syncIntent.idempotencyKey, payload, payloadHash: hashJson(payload) }, observed: structuredClone(observed) }), observed);
      } catch {
        // 必須拋出才能回滾 actor；外層只將此明確的 provider validation failure 轉成 unknown。
        throw new InvalidObservation();
      }
      const snapshotId = this.idFactory();
      const auditLogId = this.idFactory();
      const driftId = changes.length ? this.idFactory() : null;
      const observation: PlaneObservation = { snapshotId, projectId: current.mapping.projectId, mappingId,
        externalWorkItemId: current.item.id, ticketId: current.ticket.id, sourceTicketRevisionId: current.revision.id,
        actorId: this.actor.id, auditLogId };
      this.ports.auditLog.append({ id: auditLogId, projectId: observation.projectId, actorType: "mcp_client",
        actorId: this.actor.id, action: "plane_mapping.observed", entityType: "plane_observation", entityId: snapshotId,
        beforeSummary: {}, afterSummary: { mappingId, snapshotId, sourceTicketRevisionId: current.revision.id,
          contentDriftId: driftId, changedFieldCount: changes.length }, metadata: {}, createdAt: now });
      this.ports.planeObservationWrites.insertCapture({ observation,
        snapshot: { id: snapshotId, projectId: observation.projectId, externalWorkItemId: current.item.id, mappingId,
          content: observed.content, externalStatus: observed.externalStatus, concurrencyToken: observed.concurrencyToken, capturedAt },
        drift: driftId ? { id: driftId, projectId: observation.projectId, mappingId, externalWorkItemSnapshotId: snapshotId,
          diff: { schema_version: 1, source_ticket_revision_id: current.revision.id, changes },
          detectedAt: now, resolutionDecisionId: null } : null });
      return { status: "captured" as const, mappingId, snapshotId, sourceTicketRevisionId: current.revision.id,
        contentDriftId: driftId, auditLogId };
    });
  }

  private context(mappingId: string) {
    const { mapping, createRequest } = new MappingSyncReads(this.ports).getCreateRequest(mappingId);
    if (mapping.lifecycleStatus !== "active" || this.ports.syncMappingTerminations.findByMappingId(mappingId)) {
      throw new ApplicationError("CONFLICT", "Mapping is no longer active.");
    }
    const ticket = this.ports.tickets.findById(mapping.internalOwnerId);
    const item = this.ports.externalWorkItems.findById(mapping.externalWorkItemId);
    const container = this.ports.externalContainers.findById(mapping.externalContainerId);
    const revision = ticket?.currentApprovedRevisionId ? this.ports.ticketRevisions.findById(ticket.currentApprovedRevisionId) : null;
    if (!ticket || ticket.projectId !== mapping.projectId || !item || !container || container.provider !== "plane" ||
        item.externalContainerId !== container.id || item.provider !== container.provider || !item.externalId ||
        !revision || revision.reviewStatus !== "approved" || revision.ticketId !== ticket.id || revision.projectId !== ticket.projectId) {
      throw new ApplicationError("CONFLICT", "Mapping observation has invalid identity or approved revision provenance.");
    }
    const identity = hashJson({ mappingId, projectId: mapping.projectId, ticketId: ticket.id, itemId: item.id,
      externalId: item.externalId, containerId: container.id, provider: container.provider,
      workspace: container.workspaceIdentity, project: container.containerIdentity,
      createIntentId: createRequest.syncIntent.id, createKey: createRequest.syncIntent.idempotencyKey,
      sourceRevisionId: mapping.sourceTicketRevisionId });
    return { mapping, createRequest, ticket, item, container, revision, identity };
  }
}

class InvalidObservation extends Error {}
