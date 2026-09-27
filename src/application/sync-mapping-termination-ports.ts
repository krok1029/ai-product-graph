import type { MappingTerminationDetails, SyncMappingTermination } from "../domain/sync-mapping-termination.js";

export interface SyncMappingTerminationRepository {
  findByMappingId(mappingId: string): MappingTerminationDetails | null;
  insert(value: SyncMappingTermination): void;
  // 必須在 workflow transaction 中呼叫，只允許 active mapping 成功轉為 archived。
  archiveMapping(mappingId: string, archivedAt: string): boolean;
}
