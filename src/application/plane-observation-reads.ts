import { ApplicationError } from "../domain/errors.js";
import type { ApplicationPorts } from "./ports.js";
import type { ResolvedPlaneObservationHistory } from "./plane-observation-read-ports.js";
import { readContentDriftResolution } from "./content-drift-resolution-support.js";

export class PlaneObservationReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(mappingId: string): ResolvedPlaneObservationHistory {
    // Mapping、provenance 與 drift 由同一 read transaction 取得，不重新比較目前 revision。
    return this.ports.transactions.run(() => {
      let mapping;
      try { mapping = this.ports.externalWorkItems.findMappingById(mappingId); }
      catch (error) {
        if (error instanceof SyntaxError) {
          throw new ApplicationError("CONFLICT", "Plane mapping has malformed persisted metadata.", { mappingId });
        }
        throw error;
      }
      if (!mapping) throw new ApplicationError("NOT_FOUND", "Plane mapping was not found.", { mappingId });
      if (!this.ports.projects.findById(mapping.projectId)) {
        throw new ApplicationError("CONFLICT", "Plane mapping project is missing.", { mappingId });
      }
      const history = this.ports.planeObservationReads.readHistory(mapping);
      const drifts = history.drifts.map(drift => {
        const { resolution } = readContentDriftResolution(this.ports, drift.id);
        // 公開 pointer 來自已驗證關聯；原始偵測列保持不可變。
        return { ...drift, resolutionDecisionId: resolution?.decision.id ?? null, resolution };
      });
      return { mapping, observations: history.observations, drifts };
    });
  }
}
