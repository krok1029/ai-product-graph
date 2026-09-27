import { createPlaneObservationReadRepository } from "./plane-observation-read-repository.js";
import { createPlaneObservationWriteRepository } from "./plane-observation-write-repository.js";
import { createSyncMappingTerminationRepository } from "./sync-mapping-termination-repository.js";
import { createExternalWorkItemWriteRepository } from "./external-work-item-write-repository.js";
import { createPlaneEnrollmentRepository } from "./plane-enrollment-repository.js";
import { createSyncAttemptClaimRepository } from "./sync-attempt-claim-repository.js";
import { createExternalWorkItemRepository } from "./external-work-item-repository.js";
import { createSyncIntentRepositories } from "./sync-intent-repositories.js";
import { createExternalContainerRepository } from "./external-container-repository.js";
import { createResultRepositories } from "./result-repositories.js";
import { createResultAcceptanceRepositories } from "./result-acceptance-repositories.js";
// SQLite ports 組合。
//
// 把各個 SQLite adapter modules 組成 ApplicationPorts interface。每個
// submodule 負責一個 persistence area；這個檔案是 application 與 SQLite
// 溝通時使用的小 seam。

import type { ApplicationPorts } from "../../application/ports.js";
import type { SqliteDatabase } from "./database.js";
import { createAuditRepositories } from "./audit-repositories.js";
import { createCoreRepositories } from "./core-repositories.js";
import { createGraphRepositories } from "./graph-repositories.js";
import { createImplementationRepositories } from "./implementation-repositories.js";
import { createTicketRepositories } from "./ticket-repositories.js";

export function createSqlitePorts(database: SqliteDatabase): ApplicationPorts {
  return {
    planeObservationReads: createPlaneObservationReadRepository(database),
    planeObservationWrites: createPlaneObservationWriteRepository(database),
    syncMappingTerminations: createSyncMappingTerminationRepository(database),
    externalWorkItemWrites: createExternalWorkItemWriteRepository(database),
    planeEnrollment: createPlaneEnrollmentRepository(database),
    syncClaims: createSyncAttemptClaimRepository(database),
    externalWorkItems: createExternalWorkItemRepository(database),
    externalContainers: createExternalContainerRepository(database),
    ...createCoreRepositories(database),
    ...createSyncIntentRepositories(database),
    ...createResultAcceptanceRepositories(database),
    ...createResultRepositories(database),
    ...createGraphRepositories(database),
    ...createTicketRepositories(database),
    ...createImplementationRepositories(database),
    ...createAuditRepositories(database)
  };
}
