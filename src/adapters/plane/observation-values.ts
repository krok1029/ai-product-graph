import { z } from "zod";
import { canonicalizeJson } from "../../application/canonical-json.js";

// datetime 驗證日曆與格式，Date.parse 再拒絕超出範圍的 offset；保留原始微秒字串。
export const timestampSchema = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));

export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || /[\s\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

export function jsonObjectCopy(value: unknown): Record<string, unknown> {
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
