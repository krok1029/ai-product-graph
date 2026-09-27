import type { ExternalWorkItemMapping } from "./external-work-item.js";
import type { SyncIntentDetails } from "./sync-intent.js";

export type MappingSyncHistory = {
  mapping: ExternalWorkItemMapping;
  createRequest: SyncIntentDetails | null;
  intents: SyncIntentDetails[];
};
