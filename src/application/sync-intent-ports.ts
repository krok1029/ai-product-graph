import type { SyncAttempt, SyncIntent } from "../domain/sync-intent.js";

export interface SyncIntentRepository {
  findById(id: string): SyncIntent | null;
  findByIdempotencyKey(key: string): SyncIntent | null;
  insert(intent: SyncIntent): void;
  hasActiveTicketMapping(ticketId: string, containerId: string): boolean;
  hasOutstandingTicketCreate(ticketId: string, containerId: string): boolean;
  // 僅回傳 revision owner 與 pinned payload 一致的 Plane 首次 export requests。
  listByTicketId(ticketId: string): SyncIntent[];
  // 保留 mapping 的全部歷史；application 驗證 scope，不能靜默略過壞資料。
  listByMappingId(mappingId: string): SyncIntent[];
  listAttempts(syncIntentId: string): SyncAttempt[];
}
