export type SyncHealth = "current" | "pending" | "failed";

export type SyncHealthReason = { code: string; intentId?: string };

export type MappingSyncHealth = {
  syncHealth: SyncHealth;
  included: boolean;
  requiredIntentIds: string[];
  ignoredContentIntentIds: string[];
  reasons: SyncHealthReason[];
};
