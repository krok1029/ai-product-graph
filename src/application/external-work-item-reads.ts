import { ApplicationError } from "../domain/errors.js";
import type { ExternalWorkItem, ExternalWorkItemDetails, TicketExternalWorkItem } from "../domain/external-work-item.js";
import type { ApplicationPorts } from "./ports.js";

export class ExternalWorkItemReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(itemId: string): ExternalWorkItemDetails {
    const externalWorkItem = this.requireItem(itemId);
    return { externalWorkItem, mappings: this.ports.externalWorkItems.listItemMappings(itemId),
      snapshots: this.ports.externalWorkItems.listItemSnapshots(itemId) };
  }

  listTicket(ticketId: string): { items: TicketExternalWorkItem[] } {
    if (!this.ports.tickets.findById(ticketId)) {
      throw new ApplicationError("NOT_FOUND", "Ticket was not found.", { ticketId });
    }
    return { items: this.ports.externalWorkItems.listTicketMappings(ticketId).map(mapping => ({
      mapping, externalWorkItem: this.requireItem(mapping.externalWorkItemId),
      snapshots: this.ports.externalWorkItems.listMappingSnapshots(mapping.id)
    })) };
  }
  private requireItem(itemId: string): ExternalWorkItem {
    const item = this.ports.externalWorkItems.findById(itemId);
    if (!item) throw new ApplicationError("NOT_FOUND", "Plane External Work Item was not found.", { externalWorkItemId: itemId });
    return item;
  }
}
