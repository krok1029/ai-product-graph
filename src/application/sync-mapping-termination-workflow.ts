import { z } from "zod";
import { ApplicationError } from "../domain/errors.js";
import type { Decision } from "../domain/result-acceptance.js";
import type { SyncMappingTermination } from "../domain/sync-mapping-termination.js";
import type { ApplicationPorts } from "./ports.js";

const terminationCommand = z.object({
  mappingId: z.string().trim().min(1), reason: z.string().trim().min(1)
}).strict();
export type TerminateSyncMappingInput = z.input<typeof terminationCommand>;

export class SyncMappingTerminationWorkflow {
  constructor(private readonly ports: ApplicationPorts, private readonly options: {
    idFactory: () => string; clock: () => Date; actor: { id: string; displayName: string };
  }) {}

  terminate(input: TerminateSyncMappingInput) {
    const parsed = terminationCommand.safeParse(input);
    if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Invalid mapping termination command.", parsed.error.flatten());
    const command = parsed.data;
    return this.ports.transactions.run(() => {
      const now = this.options.clock().toISOString();
      // 先取得 SQLite writer lock，再讀取 mapping 與 intents，避免讀取後升級鎖的競態。
      // 後續任何驗證或寫入失敗，都會連同新 actor 一起回滾。
      this.ports.localActors.ensure({ ...this.options.actor, createdAt: now, updatedAt: now });
      const mapping = this.ports.externalWorkItems.findMappingById(command.mappingId);
      if (!mapping) throw new ApplicationError("NOT_FOUND", "Plane mapping was not found.");
      const previous = this.ports.syncMappingTerminations.findByMappingId(mapping.id);
      if (previous) throw new ApplicationError("CONFLICT", "Mapping has already been terminated.", {
        termination_id: previous.termination.id
      });
      if (mapping.lifecycleStatus !== "active") throw new ApplicationError("CONFLICT", "Mapping is already archived without a termination.");
      const intents = this.ports.syncIntents.listByMappingId(mapping.id);
      if (intents.some(intent => intent.mappingId !== mapping.id || intent.projectId !== mapping.projectId ||
          intent.externalContainerId !== mapping.externalContainerId)) {
        throw new ApplicationError("CONFLICT", "Mapping intent has invalid identity scope.");
      }
      const stoppedSyncIntentIds = intents
        .filter(intent => !this.ports.syncIntents.listAttempts(intent.id).some(attempt => attempt.resultStatus === "succeeded"))
        .map(intent => intent.id);
      const decision: Decision = { id: this.options.idFactory(), projectId: mapping.projectId,
        decisionType: "sync_mapping_termination", summary: command.reason, actorId: this.options.actor.id, createdAt: now };
      const termination: SyncMappingTermination = { id: this.options.idFactory(), projectId: mapping.projectId,
        mappingId: mapping.id, decisionId: decision.id, stoppedSyncIntentIds };
      this.ports.decisions.insert(decision);
      this.ports.syncMappingTerminations.insert(termination);
      if (!this.ports.syncMappingTerminations.archiveMapping(mapping.id, now)) {
        throw new ApplicationError("CONFLICT", "Mapping is no longer active.");
      }
      const archivedMapping = { ...mapping, lifecycleStatus: "archived" as const, archivedAt: now, updatedAt: now };
      const auditLogId = this.options.idFactory();
      this.ports.auditLog.append({ id: auditLogId, projectId: mapping.projectId, actorType: "mcp_client",
        actorId: decision.actorId, action: "sync_mapping.terminated", entityType: "sync_mapping_termination",
        entityId: termination.id, beforeSummary: { mappingId: mapping.id, lifecycleStatus: mapping.lifecycleStatus },
        afterSummary: { mapping: archivedMapping, termination, decision }, metadata: {}, createdAt: now });
      return { mapping: archivedMapping, termination, decision, auditLogId };
    });
  }
}
