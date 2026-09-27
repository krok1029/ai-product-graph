import type { SyncAttempt, SyncIntent } from "../domain/sync-intent.js";

export interface SyncIntentRepository {
  findById(id: string): SyncIntent | null;
  // 僅回傳 revision owner 與 pinned payload 一致的 Plane 首次 export requests。
  listByTicketId(ticketId: string): SyncIntent[];
  listAttempts(syncIntentId: string): SyncAttempt[];
}
