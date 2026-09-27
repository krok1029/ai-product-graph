import { ApplicationError } from "../domain/errors.js";
import type { ApplicationPorts } from "./ports.js";
import type { PlaneObservationHistory } from "./plane-observation-read-ports.js";

export class PlaneObservationReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(mappingId: string): PlaneObservationHistory {
    // Mapping、provenance 與 drift 由同一 read transaction 取得，不重新比較目前 revision。
    return this.ports.transactions.run(() => {
      const mapping = this.ports.externalWorkItems.findMappingById(mappingId);
      if (!mapping) throw new ApplicationError("NOT_FOUND", "Plane mapping was not found.", { mappingId });
      if (!this.ports.projects.findById(mapping.projectId)) {
        throw new ApplicationError("CONFLICT", "Plane mapping project is missing.", { mappingId });
      }
      return { mapping, ...this.ports.planeObservationReads.readHistory(mapping) };
    });
  }
}
