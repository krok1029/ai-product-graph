import { z } from "zod";
import { canonicalizeJson } from "../../application/canonical-json.js";
import { hashJson } from "../../application/plane-export-payload.js";
import type { PlaneCreateRequest, PlaneItemObservation } from "../../application/plane-provider-port.js";

const nonempty = z.string().refine(value => value.trim().length > 0);
const specificationSchema = z.object({
  title: nonempty,
  user_story: nonempty,
  scope: z.array(nonempty),
  acceptance_criteria: z.array(z.object({ id: nonempty, text: nonempty })).min(1),
  non_goals: z.array(nonempty),
  implementation_notes: z.array(nonempty).optional()
});
const payloadSchema = z.object({
  schema_version: z.literal(1),
  owner: z.object({ type: z.literal("ticket"), id: nonempty }),
  source_ticket_revision_id: nonempty,
  specification: specificationSchema
});
// datetime 驗證日曆與格式，Date.parse 再拒絕超出範圍的 offset；保留原始微秒字串。
const timestampSchema = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const externalSource = "ai-product-graph";

export function planeCreateFields(request: PlaneCreateRequest): {
  name: string; description_html: string; external_source: string; external_id: string;
} {
  const payload = requirePayload(request);
  const specification = payload.specification;
  const criteria = specification.acceptance_criteria.map(criterion =>
    `<li><strong>${escapeHtml(criterion.id)}</strong>: ${escapeHtml(criterion.text)}</li>`).join("");
  return {
    name: specification.title,
    description_html: [
      `<h2>User story</h2><p>${escapeHtml(specification.user_story)}</p>`,
      htmlList("Scope", specification.scope),
      `<h2>Acceptance criteria</h2><ul>${criteria}</ul>`,
      htmlList("Non-goals", specification.non_goals),
      ...(specification.implementation_notes?.length
        ? [htmlList("Implementation notes", specification.implementation_notes)] : [])
    ].join("\n"),
    external_source: externalSource,
    external_id: request.idempotencyKey
  };
}

export function planeItemObservation(value: unknown, request: PlaneCreateRequest): PlaneItemObservation | null {
  try {
    requirePayload(request);
    // 先驗證純 JSON 再複製；未知欄位與 __proto__ 自有 key 必須保留，且不共用可變物件。
    const content = jsonObjectCopy(value);
    if (!nonempty.safeParse(content.id).success ||
        content.external_source !== externalSource || content.external_id !== request.idempotencyKey ||
        content.project !== request.container.containerIdentity) return null;
    if (content.state !== undefined && content.state !== null && typeof content.state !== "string") return null;
    if (content.updated_at !== undefined && !timestampSchema.safeParse(content.updated_at).success) return null;
    return {
      externalId: content.id as string,
      externalUrl: httpUrl(content.url),
      content,
      externalStatus: typeof content.state === "string" ? content.state : null,
      concurrencyToken: typeof content.updated_at === "string" ? content.updated_at : null
    };
  } catch {
    return null;
  }
}

function requirePayload(request: PlaneCreateRequest) {
  const payload = jsonObjectCopy(request.payload);
  if (request.container.provider !== "plane" || !nonempty.safeParse(request.container.workspaceIdentity).success ||
      !nonempty.safeParse(request.container.containerIdentity).success || !nonempty.safeParse(request.idempotencyKey).success ||
      hashJson(payload) !== request.payloadHash) {
    throw new Error("Invalid pinned Plane create request.");
  }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || new Set(parsed.data.specification.acceptance_criteria.map(criterion => criterion.id)).size !==
      parsed.data.specification.acceptance_criteria.length) throw new Error("Invalid pinned Plane create payload.");
  return parsed.data;
}

function htmlList(title: string, values: string[]): string {
  return `<h2>${title}</h2><ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n|\r|\n/g, "<br>");
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || /[\s\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

function jsonObjectCopy(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
  assertJson(value, new Set());
  return JSON.parse(canonicalizeJson(value)) as Record<string, unknown>;
}

function assertJson(value: unknown, ancestors: Set<object>, depth = 0): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value !== "object" || depth > 64 || ancestors.has(value)) throw new Error("Invalid JSON value.");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error("Invalid JSON object.");
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && keys.length !== value.length + 1) throw new Error("Invalid JSON array.");
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string" || (Array.isArray(value) &&
        (!Number.isInteger(Number(key)) || Number(key) < 0 || Number(key) >= value.length || String(Number(key)) !== key))) {
      throw new Error("Invalid JSON key.");
    }
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("Invalid JSON property.");
    assertJson(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}
