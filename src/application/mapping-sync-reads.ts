import { ApplicationError } from "../domain/errors.js";
import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { MappingSyncHistory } from "../domain/mapping-sync-history.js";
import type { SyncIntentDetails } from "../domain/sync-intent.js";
import { hashJson } from "./plane-export-payload.js";
import type { ApplicationPorts } from "./ports.js";
import { SyncIntentReads } from "./sync-intent-reads.js";

export class MappingSyncReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(mappingId: string): MappingSyncHistory {
    // 所有 intents、attempts 與原始 create proof 必須來自同一個 SQLite snapshot。
    return this.ports.transactions.run(() => {
      const mapping = this.ports.externalWorkItems.findMappingById(mappingId);
      if (!mapping) throw new ApplicationError("NOT_FOUND", "Plane mapping was not found.", { mappingId });
      const reads = new SyncIntentReads(this.ports);
      const intents = this.ports.syncIntents.listByMappingId(mappingId).map(intent => reads.get(intent.id));
      if (!Number.isSafeInteger(mapping.nextSequenceNumber) || mapping.nextSequenceNumber < 1) invalid(mapping, "invalid_obligation");
      const sequences = new Set<number>();
      for (const details of intents) {
        this.validate(details, mapping, false);
        const sequence = details.syncIntent.sequenceNumber!;
        if (sequences.has(sequence) || sequence >= mapping.nextSequenceNumber) invalid(mapping, "invalid_obligation");
        sequences.add(sequence);
      }
      if (sequences.size !== mapping.nextSequenceNumber - 1) invalid(mapping, "incomplete_history");
      const createRequest = this.originalCreate(mapping);
      return { mapping, createRequest, intents };
    });
  }

  getCreateRequest(mappingId: string): { mapping: ExternalWorkItemMapping; createRequest: SyncIntentDetails } {
    // Explicit observation 只需要原始 create proof，不依賴後續 outbound obligation history。
    return this.ports.transactions.run(() => {
      const mapping = this.ports.externalWorkItems.findMappingById(mappingId);
      if (!mapping) throw new ApplicationError("NOT_FOUND", "Plane mapping was not found.", { mappingId });
      return { mapping, createRequest: this.originalCreate(mapping) };
    });
  }

  private originalCreate(mapping: ExternalWorkItemMapping): SyncIntentDetails {
    const reads = new SyncIntentReads(this.ports);
    const linkedId = record(mapping.metadata)?.created_by_sync_intent_id;
    if (typeof linkedId !== "string" || !this.ports.syncIntents.findById(linkedId)) invalid(mapping, "incomplete_history");
    const createRequest = reads.get(linkedId);
    this.validate(createRequest, mapping, true);
    const snapshots = this.ports.externalWorkItems.listMappingSnapshots(mapping.id);
    const item = this.ports.externalWorkItems.findById(mapping.externalWorkItemId);
    const proven = createRequest.attempts.some(attempt => {
      const response = record(attempt.response);
      return attempt.resultStatus === "succeeded" && attempt.externalWorkItemId === mapping.externalWorkItemId &&
        response?.mapping_id === mapping.id && response.external_id === item?.externalId &&
        snapshots.some(snapshot => snapshot.id === response.snapshot_id);
    });
    if (!proven) invalid(mapping, "incomplete_history", linkedId);
    return createRequest;
  }

  private validate(details: SyncIntentDetails, mapping: ExternalWorkItemMapping, original: boolean) {
    const intent = details.syncIntent;
    const payload = record(intent.payload);
    const owner = record(payload?.owner);
    const revision = intent.sourceTicketRevisionId ? this.ports.ticketRevisions.findById(intent.sourceTicketRevisionId) : null;
    const content = intent.operation === "create" || intent.operation === "update";
    const status = payload?.delivery_status;
    const validOperation = content ? validSpecification(payload?.specification) :
      intent.operation === "close" ? status === "done" :
        intent.operation === "reopen" && ["planned", "in_progress", "blocked"].includes(String(status));
    if (intent.projectId !== mapping.projectId || intent.externalContainerId !== mapping.externalContainerId ||
        owner?.type !== "ticket" || owner.id !== mapping.internalOwnerId || !revision ||
        revision.ticketId !== mapping.internalOwnerId || revision.projectId !== mapping.projectId || revision.reviewStatus !== "approved" ||
        payload?.schema_version !== 1 || payload.source_ticket_revision_id !== revision.id || !validOperation ||
        hashJson(payload) !== intent.payloadHash || !intent.idempotencyKey || !intent.sourceEventId ||
        (original ? intent.mappingId !== null || intent.sequenceNumber !== null || intent.operation !== "create" ||
          intent.sourceEventType !== "plane_ticket_export_requested" || revision.id !== mapping.sourceTicketRevisionId :
          intent.mappingId !== mapping.id || !Number.isSafeInteger(intent.sequenceNumber) || intent.sequenceNumber! < 1)) {
      invalid(mapping, "invalid_obligation", intent.id);
    }
    for (const attempt of details.attempts) {
      if (attempt.syncIntentId !== intent.id || attempt.operation !== intent.operation ||
          attempt.idempotencyKey !== intent.idempotencyKey ||
          (attempt.externalWorkItemId !== null && attempt.externalWorkItemId !== mapping.externalWorkItemId) ||
          (attempt.resultStatus === "started" ? attempt.completedAt !== null : attempt.completedAt === null) ||
          (attempt.resultStatus === "succeeded" && attempt.externalWorkItemId !== mapping.externalWorkItemId)) {
        invalid(mapping, "invalid_obligation", intent.id);
      }
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validSpecification(value: unknown): boolean {
  const specification = record(value);
  const strings = (field: unknown) => Array.isArray(field) && field.every(item => typeof item === "string");
  return !!specification && typeof specification.title === "string" && typeof specification.user_story === "string" &&
    strings(specification.scope) && strings(specification.non_goals) && strings(specification.implementation_notes) &&
    Array.isArray(specification.acceptance_criteria) && specification.acceptance_criteria.every(value => {
      const criterion = record(value);
      return typeof criterion?.id === "string" && typeof criterion.text === "string";
    });
}

function invalid(mapping: ExternalWorkItemMapping, reason: string, intentId?: string): never {
  throw new ApplicationError("CONFLICT", "Mapping sync history has incomplete or invalid provenance.", {
    mappingId: mapping.id, reason, ...(intentId ? { intentId } : {})
  });
}
