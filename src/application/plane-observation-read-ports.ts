import type { ContentDriftEvidence } from "../domain/content-drift-resolution.js";
import type { ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../domain/external-work-item.js";
import type { ContentDrift, PlaneObservation } from "../domain/plane-observation.js";

export type PlaneObservationHistory = {
  mapping: ExternalWorkItemMapping;
  observations: { snapshot: ExternalWorkItemSnapshot; provenance: PlaneObservation }[];
  drifts: ContentDrift[];
};

export interface PlaneObservationReadRepository {
  readDrift(contentDriftId: string): ContentDriftEvidence | null;
  readHistory(mapping: ExternalWorkItemMapping): Omit<PlaneObservationHistory, "mapping">;
}
