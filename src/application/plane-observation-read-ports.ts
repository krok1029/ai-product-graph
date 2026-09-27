import type { ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../domain/external-work-item.js";
import type { ContentDrift, PlaneObservation } from "../domain/plane-observation.js";

export type PlaneObservationHistory = {
  mapping: ExternalWorkItemMapping;
  observations: { snapshot: ExternalWorkItemSnapshot; provenance: PlaneObservation }[];
  drifts: ContentDrift[];
};

export interface PlaneObservationReadRepository {
  readHistory(mapping: ExternalWorkItemMapping): Omit<PlaneObservationHistory, "mapping">;
}
