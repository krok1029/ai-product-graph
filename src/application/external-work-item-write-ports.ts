import type { ExternalWorkItem, ExternalWorkItemMapping, ExternalWorkItemSnapshot } from "../domain/external-work-item.js";

export type CreatedExternalProjection = {
  externalWorkItem: ExternalWorkItem;
  mapping: ExternalWorkItemMapping;
  snapshot: ExternalWorkItemSnapshot;
};

export interface ExternalWorkItemWriteRepository {
  // Caller 必須已取得 claim fence，並在同一 transaction 提交 outcome 與 audit。
  insertCreatedProjection(projection: CreatedExternalProjection): void;
}
