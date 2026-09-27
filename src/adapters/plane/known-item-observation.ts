import type { PlaneReadRequest } from "../../application/plane-observation-ports.js";
import type { PlaneItemObservation } from "../../application/plane-provider-port.js";
import { httpUrl, jsonObjectCopy, timestampSchema } from "./observation-values.js";

// 已知 item 以儲存的 identity 驗證；markers 的缺漏與改動留給 managed-content 比較。
export function planeKnownItemObservation(value: unknown, request: PlaneReadRequest): PlaneItemObservation | null {
  try {
    const content = jsonObjectCopy(value);
    if (request.container.provider !== "plane" || !nonempty(request.container.workspaceIdentity) ||
        !nonempty(request.container.containerIdentity) || !nonempty(request.externalId) ||
        content.id !== request.externalId || content.project !== request.container.containerIdentity ||
        typeof content.name !== "string" || typeof content.description_html !== "string") return null;
    for (const field of ["external_source", "external_id"]) {
      if (Object.hasOwn(content, field) && content[field] !== null && typeof content[field] !== "string") return null;
    }
    if (content.state !== undefined && content.state !== null && typeof content.state !== "string") return null;
    if (content.updated_at !== undefined && !timestampSchema.safeParse(content.updated_at).success) return null;
    return {
      externalId: request.externalId, externalUrl: httpUrl(content.url), content,
      externalStatus: typeof content.state === "string" ? content.state : null,
      concurrencyToken: typeof content.updated_at === "string" ? content.updated_at : null
    };
  } catch { return null; }
}

function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
