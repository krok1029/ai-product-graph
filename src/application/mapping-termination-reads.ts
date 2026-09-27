import { ApplicationError } from "../domain/errors.js";
import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { MappingTerminationDetails } from "../domain/sync-mapping-termination.js";
import type { SyncIntentDetails } from "../domain/sync-intent.js";
import type { ApplicationPorts } from "./ports.js";
import { SyncIntentReads } from "./sync-intent-reads.js";

export type MappingTerminationHistory = {
  mappingId: string;
  termination: (MappingTerminationDetails & { stoppedIntents: SyncIntentDetails[] }) | null;
};

export class MappingTerminationReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(mappingId: string): MappingTerminationHistory {
    // Decision、membership 與 attempts 必須來自同一 snapshot；讀取不改寫停止前的真實結果。
    return this.ports.transactions.run(() => {
      const mapping = this.ports.externalWorkItems.findMappingById(mappingId);
      if (!mapping) throw new ApplicationError("NOT_FOUND", "Plane mapping was not found.", { mappingId });
      const details = this.ports.syncMappingTerminations.findByMappingId(mappingId);
      if (!details) return { mappingId, termination: null };
      const { termination, decision } = details;
      if (termination.mappingId !== mappingId || termination.projectId !== mapping.projectId ||
          termination.decisionId !== decision.id || decision.projectId !== mapping.projectId ||
          decision.decisionType !== "sync_mapping_termination" || mapping.lifecycleStatus !== "archived" ||
          !mapping.archivedAt || decision.createdAt !== mapping.archivedAt ||
          new Set(termination.stoppedSyncIntentIds).size !== termination.stoppedSyncIntentIds.length) {
        invalid(mappingId);
      }
      const reads = new SyncIntentReads(this.ports);
      const stoppedIntents = termination.stoppedSyncIntentIds.map(id => {
        if (!this.ports.syncIntents.findById(id)) invalid(mappingId, id);
        const intent = reads.get(id);
        validateMember(mapping, intent);
        return intent;
      }).sort((left, right) => left.syncIntent.sequenceNumber! - right.syncIntent.sequenceNumber! ||
        left.syncIntent.id.localeCompare(right.syncIntent.id));
      return { mappingId, termination: { ...details, stoppedIntents } };
    });
  }
}

function validateMember(mapping: ExternalWorkItemMapping, details: SyncIntentDetails) {
  const intent = details.syncIntent;
  if (intent.mappingId !== mapping.id || intent.projectId !== mapping.projectId ||
      intent.externalContainerId !== mapping.externalContainerId ||
      !Number.isSafeInteger(intent.sequenceNumber) || intent.sequenceNumber! < 1) invalid(mapping.id, intent.id);
  for (const attempt of details.attempts) {
    if (attempt.syncIntentId !== intent.id || attempt.operation !== intent.operation ||
        attempt.idempotencyKey !== intent.idempotencyKey ||
        (attempt.externalWorkItemId !== null && attempt.externalWorkItemId !== mapping.externalWorkItemId) ||
        !["started", "failed"].includes(attempt.resultStatus) ||
        (attempt.resultStatus === "started" ? attempt.completedAt !== null : attempt.completedAt === null)) {
      invalid(mapping.id, intent.id);
    }
  }
}

function invalid(mappingId: string, intentId?: string): never {
  throw new ApplicationError("CONFLICT", "Mapping termination has invalid identity or stopped-obligation history.", {
    mappingId, ...(intentId ? { intentId } : {})
  });
}
