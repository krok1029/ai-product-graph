import { validationError } from "./implementation-workflow-helpers.js";

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw validationError("JSON numbers must be finite.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertUnicode(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map(key => {
        assertUnicode(key);
        return `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`;
      })
      .join(",")}}`;
  }
  throw validationError("payload contains unsupported JSON value.");
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// RFC 8785 禁止孤立 surrogate；不能交由 JSON.stringify 靜默 escape。
function assertUnicode(value: string) {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) {
      throw validationError("payload strings must contain valid Unicode.");
    }
  }
}

