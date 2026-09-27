import { ulid } from "ulid";
import { PlaneCreateProcessor } from "./plane-create-processor.js";
import { PlaneMappingEnrollment } from "./plane-mapping-enrollment.js";
import type { PlaneProviderPort } from "./plane-provider-port.js";
import type { ApplicationPorts } from "./ports.js";
import type { SyncAttemptClaimsOptions } from "./sync-attempt-claims.js";

// 開發呼叫端共用完整 composition；建立物件不會啟動 processor 或連線外部 provider。
export function createPlaneCreateProcessor(ports: ApplicationPorts, provider: PlaneProviderPort, options: SyncAttemptClaimsOptions = {}) {
  const idFactory = options.idFactory ?? ulid;
  return new PlaneCreateProcessor(ports, provider, new PlaneMappingEnrollment(ports, idFactory), { ...options, idFactory });
}
