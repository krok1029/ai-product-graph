import { canonicalizeJson } from "./canonical-json.js";
import type { ManagedFieldChange, PlaneReadOutcome } from "./plane-observation-ports.js";
import type { PlaneItemObservation } from "./plane-provider-port.js";

export const managedFields = ["name", "description_html", "external_source", "external_id"] as const;
const safeCodes = new Set(["INVALID_PLANE_REQUEST", "PLANE_HTTP_REJECTED", "INVALID_PLANE_RESPONSE",
  "PLANE_TIMEOUT", "PLANE_RESPONSE_TOO_LARGE", "PLANE_TRANSPORT_ERROR"]);

export function unknownObservation(value?: unknown): Extract<PlaneReadOutcome, { status: "unknown" }> {
  const error = record(value);
  const code = typeof error?.code === "string" && safeCodes.has(error.code) ? error.code : "INVALID_PLANE_RESPONSE";
  const status = error?.http_status;
  return { status: "unknown", error: { code,
    ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? { http_status: status } : {}) } };
}

export function validateObservation(value: unknown, externalId: string, project: string): PlaneItemObservation {
  const item = record(value);
  const content = record(item?.content);
  if (!item || !content || item.externalId !== externalId || content.id !== externalId || content.project !== project ||
      !nullableString(item.externalUrl) || !nullableString(item.externalStatus) || !nullableString(item.concurrencyToken) ||
      typeof content.name !== "string" || typeof content.description_html !== "string" ||
      ["external_source", "external_id"].some(field => Object.hasOwn(content, field) && !nullableString(content[field]))) {
    throw new Error("INVALID_PLANE_RESPONSE");
  }
  if (item.externalUrl !== null) {
    const url = new URL(item.externalUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("INVALID_PLANE_RESPONSE");
  }
  // 拒絕非 JSON objects、cycles 與非有限數字，不讓 clone 靜默丟失 provider 資料。
  assertJson(item, new Set());
  return JSON.parse(canonicalizeJson(item)) as PlaneItemObservation;
}

export function validateChanges(value: unknown, observed: PlaneItemObservation): ManagedFieldChange[] {
  if (!Array.isArray(value)) throw new Error("INVALID_PLANE_RESPONSE");
  let previous = -1;
  for (const change of value) {
    const row = record(change);
    const index = managedFields.indexOf(row?.field as typeof managedFields[number]);
    const actual = record(row?.observed);
    if (!row || index <= previous || typeof row.expected !== "string" || !actual ||
        Object.keys(row).sort().join(",") !== "expected,field,observed" ||
        Object.keys(actual).sort().join(",") !== (actual.present === true ? "present,value" : "present")) throw new Error("INVALID_PLANE_RESPONSE");
    const field = managedFields[index]!;
    const present = Object.hasOwn(observed.content, field);
    if (actual.present !== present || (present ? !nullableString(actual.value) || actual.value !== observed.content[field] ||
        actual.value === row.expected : Object.hasOwn(actual, "value"))) throw new Error("INVALID_PLANE_RESPONSE");
    previous = index;
  }
  assertJson(value, new Set());
  return JSON.parse(canonicalizeJson(value)) as ManagedFieldChange[];
}

function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function assertJson(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value !== "object" || ancestors.has(value) ||
      (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw new Error("INVALID_PLANE_RESPONSE");
  if (Object.getOwnPropertySymbols(value).length) throw new Error("INVALID_PLANE_RESPONSE");
  ancestors.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) assertJson(entry, ancestors);
  ancestors.delete(value);
}
