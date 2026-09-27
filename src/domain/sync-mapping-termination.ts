import type { Decision } from "./result-acceptance.js";

export type SyncMappingTermination = {
  id: string;
  projectId: string;
  mappingId: string;
  decisionId: string;
  stoppedSyncIntentIds: string[];
};

export type MappingTerminationDetails = {
  termination: SyncMappingTermination;
  decision: Decision;
};
