// Content Drift 的不可變處置關係；拒絕與採用共用此契約。
import type { ContentDriftResolution, ContentDriftResolutionDetails } from "../domain/content-drift-resolution.js";

export interface ContentDriftResolutionRepository {
  // 保留原始 association；遺失或損壞的 linked evidence 不可偽裝成尚未處理。
  findByDriftId(contentDriftId: string): ContentDriftResolutionDetails | null;
  insert(record: ContentDriftResolution): void;
}
