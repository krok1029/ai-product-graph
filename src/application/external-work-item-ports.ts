import type { ExternalWorkItem, ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../domain/external-work-item.js";

export interface ExternalWorkItemRepository {
  hasInvalidTicketMappings(ticketId: string): boolean;
  findById(id: string): ExternalWorkItem | null;
  findMappingById(id: string): ExternalWorkItemMapping | null;
  // 僅包含 Project、Ticket owner、source revision 與 Plane container 一致的 mappings。
  listTicketMappings(ticketId: string): ExternalWorkItemMapping[];
  listItemMappings(itemId: string): ExternalWorkItemMapping[];
  listMappingSnapshots(mappingId: string): ExternalWorkItemSnapshot[];
  listItemSnapshots(itemId: string): ExternalWorkItemSnapshot[];
}
