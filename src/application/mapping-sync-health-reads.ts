import { ApplicationError } from "../domain/errors.js";
import type { MappingSyncHealth } from "../domain/sync-health.js";
import { deriveMappingSyncHealth } from "./derive-mapping-sync-health.js";
import { MappingSyncReads } from "./mapping-sync-reads.js";
import type { ApplicationPorts } from "./ports.js";

export class MappingSyncHealthReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(mappingId: string): MappingSyncHealth {
    return this.ports.transactions.run(() => {
      let mapping;
      try {
        mapping = this.ports.externalWorkItems.findMappingById(mappingId);
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "CONFLICT") return incompleteHealth(true);
        throw error;
      }
      if (!mapping) throw new ApplicationError("NOT_FOUND", "External Work Item mapping was not found.", { mappingId });
      const ticket = this.ports.tickets.findById(mapping.internalOwnerId);
      if (!ticket) throw new ApplicationError("NOT_FOUND", "Ticket was not found.", { ticketId: mapping.internalOwnerId });
      try {
        const history = new MappingSyncReads(this.ports).get(mappingId);
        const revision = ticket.currentApprovedRevisionId && this.ports.ticketRevisions.findById(ticket.currentApprovedRevisionId);
        if (!revision || revision.ticketId !== ticket.id || revision.projectId !== mapping.projectId || revision.reviewStatus !== "approved") {
          return incompleteHealth(mapping.lifecycleStatus === "active");
        }
        return deriveMappingSyncHealth({ ...history, ticket });
      } catch (error) {
        // 讀取診斷不能把先前已 commit 的 approval 呈現為失敗；原始 history API 仍回傳 corruption error。
        if (error instanceof ApplicationError && error.code === "CONFLICT") return incompleteHealth(mapping.lifecycleStatus === "active");
        throw error;
      }
    });
  }
}

function incompleteHealth(included: boolean): MappingSyncHealth {
  return { syncHealth: included ? "pending" : "current", included, requiredIntentIds: [], ignoredContentIntentIds: [],
    reasons: [{ code: included ? "incomplete_history" : "mapping_archived" }] };
}
