// 歷史處置只驗證保存時的證據，不套用目前 Ticket 或規劃來源的 freshness gate。
import type { ContentDriftResolutionView } from "../domain/content-drift-resolution.js";
import type { ApplicationPorts } from "./ports.js";
import { readContentDriftResolution } from "./content-drift-resolution-support.js";

export class ContentDriftResolutionReads {
  constructor(private readonly ports: ApplicationPorts) {}

  get(contentDriftId: string): ContentDriftResolutionView {
    return this.ports.transactions.run(() => readContentDriftResolution(this.ports, contentDriftId));
  }
}
