import { ApplicationError } from "../domain/errors.js";
import type { SyncIntent, SyncIntentDetails, SyncIntentRequestState } from "../domain/sync-intent.js";
import type { ApplicationPorts } from "./ports.js";

export class SyncIntentReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(syncIntentId: string): SyncIntentDetails {
    const intent = this.ports.syncIntents.findById(syncIntentId);
    if (!intent) throw new ApplicationError("NOT_FOUND", "Sync Intent was not found.", { syncIntentId });
    return this.details(intent);
  }

  listTicketExportRequests(ticketId: string): { requests: SyncIntentDetails[] } {
    if (!this.ports.tickets.findById(ticketId)) {
      throw new ApplicationError("NOT_FOUND", "Ticket was not found.", { ticketId });
    }
    return { requests: this.ports.syncIntents.listByTicketId(ticketId).map(intent => this.details(intent)) };
  }

  private details(syncIntent: SyncIntent): SyncIntentDetails {
    const attempts = this.ports.syncIntents.listAttempts(syncIntent.id);
    let requestState: SyncIntentRequestState;
    if (syncIntent.lifecycleStatus === "archived") requestState = "archived";
    else if (attempts.some(attempt => attempt.resultStatus === "succeeded")) requestState = "succeeded";
    else {
      const latest = attempts.at(-1);
      requestState = !latest ? "pending" : latest.resultStatus === "started" ? "running" : "failed";
    }
    return { syncIntent, attempts, requestState };
  }
}
