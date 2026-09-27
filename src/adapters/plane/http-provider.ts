import type {
  PlaneCreateOutcome, PlaneCreateRequest, PlaneItemObservation, PlaneProviderPort, PlaneReconcileOutcome
} from "../../application/plane-provider-port.js";
import { canonicalizeJson } from "../../application/canonical-json.js";
import { planeCreateFields, planeItemObservation } from "./fields.js";
import { PlaneHttpError, PlaneHttpInvocation, planeHttpConfig, type PlaneHttpConfig } from "./http-transport.js";

export type { PlaneHttpConfig } from "./http-transport.js";

// Adapter 不啟動 background work；每次 method 僅執行呼叫者已持久化的 invocation。
export class PlaneHttpProvider implements PlaneProviderPort {
  private readonly config;
  constructor(config: PlaneHttpConfig) { this.config = planeHttpConfig(config); }

  async create(request: PlaneCreateRequest): Promise<PlaneCreateOutcome> {
    let url: URL;
    let body: ReturnType<typeof planeCreateFields>;
    try { url = this.endpoint(request); body = planeCreateFields(request); }
    catch { return { status: "failed", error: { code: "INVALID_PLANE_REQUEST" } }; }
    const invocation = new PlaneHttpInvocation(this.config);
    try {
      const response = await invocation.request(url, body);
      if (!response.ok) return { status: "failed", error: { code: "PLANE_HTTP_REJECTED", http_status: response.status } };
      const item = planeItemObservation(await invocation.json(response), request);
      return item ? { status: "succeeded", item } : unknown("INVALID_PLANE_RESPONSE");
    } catch (error) { return transportFailure(error); }
    finally { invocation.close(); }
  }

  async reconcile(request: PlaneCreateRequest): Promise<PlaneReconcileOutcome> {
    let endpoint: URL;
    try { endpoint = this.endpoint(request); planeCreateFields(request); }
    catch { return unknown("INVALID_PLANE_REQUEST"); }
    const invocation = new PlaneHttpInvocation(this.config);
    const items = new Map<string, PlaneItemObservation>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < this.config.maxPages; page++) {
        const url = new URL(endpoint);
        url.searchParams.set("external_source", "ai-product-graph");
        url.searchParams.set("external_id", request.idempotencyKey);
        if (cursor !== undefined) url.searchParams.set("cursor", cursor);
        const response = await invocation.request(url);
        if (!response.ok) return unknown("PLANE_HTTP_REJECTED", response.status);
        const value = await invocation.json(response);
        if (!isRecord(value)) return unknown("INVALID_PLANE_RESPONSE");
        // 官方 filtered GET 可回單筆 object；一般 list 則回 cursor envelope。
        const paginated = Object.hasOwn(value, "results");
        if (paginated && (!Array.isArray(value.results) || typeof value.next_page_results !== "boolean")) {
          return unknown("INVALID_PLANE_RESPONSE");
        }
        const records = paginated ? value.results as unknown[] : [value];
        for (const record of records) {
          const item = planeItemObservation(record, request);
          if (!item) return unknown("INVALID_PLANE_RESPONSE");
          const previous = items.get(item.externalId);
          if (previous && canonicalizeJson(previous.content) !== canonicalizeJson(item.content)) {
            return unknown("AMBIGUOUS_PLANE_RESPONSE");
          }
          items.set(item.externalId, item);
          if (items.size > 1) return unknown("AMBIGUOUS_PLANE_RESPONSE");
        }
        if (!paginated || value.next_page_results === false) {
          const item = items.values().next().value;
          return item ? { status: "found", item } : unknown("PLANE_ITEM_NOT_OBSERVED");
        }
        if (typeof value.next_cursor !== "string" || !value.next_cursor.trim() || cursors.has(value.next_cursor)) {
          return unknown("INVALID_PLANE_CURSOR");
        }
        cursor = value.next_cursor;
        cursors.add(cursor);
      }
      return unknown("PLANE_PAGE_LIMIT");
    } catch (error) { return transportFailure(error); }
    finally { invocation.close(); }
  }

  private endpoint(request: PlaneCreateRequest): URL {
    if (request.container.provider !== "plane") throw new PlaneHttpError("INVALID_PLANE_REQUEST");
    const segment = (value: string) => {
      if (typeof value !== "string" || !value.trim() || value === "." || value === "..") {
        throw new PlaneHttpError("INVALID_PLANE_REQUEST");
      }
      return encodeURIComponent(value);
    };
    return new URL(`/api/v1/workspaces/${segment(request.container.workspaceIdentity)}/projects/${segment(request.container.containerIdentity)}/work-items/`, this.config.origin);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknown(code: string, httpStatus?: number) {
  return { status: "unknown" as const, error: { code, ...(httpStatus === undefined ? {} : { http_status: httpStatus }) } };
}

function transportFailure(error: unknown) {
  return unknown(error instanceof PlaneHttpError ? error.code : "PLANE_TRANSPORT_ERROR");
}
