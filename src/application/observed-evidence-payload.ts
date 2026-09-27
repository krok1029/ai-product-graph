import { canonicalizeJson } from "./canonical-json.js";
// Observed Evidence 的 closed schema、語意正規化與 canonical JSON hash。

import { createHash } from "node:crypto";
import type { ObservedEvidenceType } from "../domain/models.js";
import { validationError } from "./implementation-workflow-helpers.js";

export function normalizeObservedEvidencePayload(
  evidenceType: ObservedEvidenceType,
  payload: unknown
) {
  if (!isRecord(payload)) {
    throw validationError("payload must be an object.");
  }
  const normalized = normalizeEvidencePayloadByType(evidenceType, payload);
  const canonicalJson = canonicalizeJson(normalized);
  return {
    payload: normalized,
    canonicalJson,
    payloadHash: `sha256:${createHash("sha256")
      .update(canonicalJson, "utf8")
      .digest("hex")}`
  };
}

function normalizeEvidencePayloadByType(
  evidenceType: ObservedEvidenceType,
  payload: Record<string, unknown>
): Record<string, unknown> {
  assertSchemaVersion(payload);
  switch (evidenceType) {
    case "commit":
      assertAllowedKeys(payload, [
        "schema_version",
        "commit_sha",
        "message",
        "authored_at",
        "committed_at",
        "parent_shas",
        "changed_files"
      ]);
      return {
        schema_version: 1,
        commit_sha: requiredString(payload.commit_sha, "payload.commit_sha"),
        ...(optionalString(payload.message) === null
          ? {}
          : { message: optionalString(payload.message) }),
        ...(payload.authored_at === undefined
          ? {}
          : { authored_at: requiredTimestamp(payload.authored_at, "payload.authored_at") }),
        committed_at: requiredTimestamp(payload.committed_at, "payload.committed_at"),
        ...(payload.parent_shas === undefined
          ? {}
          : { parent_shas: stringArray(payload.parent_shas, "payload.parent_shas") }),
        changed_files: normalizeChangedFiles(payload.changed_files)
      };
    case "pull_request":
      assertAllowedKeys(payload, [
        "schema_version",
        "provider",
        "external_id",
        "url",
        "title",
        "source_branch",
        "target_branch",
        "status",
        "head_commit_sha",
        "created_at",
        "updated_at"
      ]);
      return {
        schema_version: 1,
        provider: requiredString(payload.provider, "payload.provider"),
        external_id: requiredString(payload.external_id, "payload.external_id"),
        url: requiredString(payload.url, "payload.url"),
        title: requiredString(payload.title, "payload.title"),
        ...(optionalString(payload.source_branch) === null
          ? {}
          : { source_branch: optionalString(payload.source_branch) }),
        ...(optionalString(payload.target_branch) === null
          ? {}
          : { target_branch: optionalString(payload.target_branch) }),
        status: requiredEnum(payload.status, "payload.status", [
          "draft",
          "open",
          "merged",
          "closed"
        ]),
        head_commit_sha: requiredString(
          payload.head_commit_sha,
          "payload.head_commit_sha"
        ),
        ...(payload.created_at === undefined
          ? {}
          : { created_at: requiredTimestamp(payload.created_at, "payload.created_at") }),
        ...(payload.updated_at === undefined
          ? {}
          : { updated_at: requiredTimestamp(payload.updated_at, "payload.updated_at") })
      };
    case "test_execution": {
      assertAllowedKeys(payload, [
        "schema_version",
        "command",
        "status",
        "started_at",
        "completed_at",
        "exit_code",
        "summary",
        "log_artifact_ref"
      ]);
      const status = requiredEnum(payload.status, "payload.status", [
        "passed",
        "failed",
        "errored",
        "cancelled"
      ]);
      const startedAt = requiredTimestamp(payload.started_at, "payload.started_at");
      const completedAt = requiredTimestamp(
        payload.completed_at,
        "payload.completed_at"
      );
      if (completedAt < startedAt) {
        throw validationError("payload.completed_at must be after started_at.");
      }
      const exitCode = normalizeExitCode(payload.exit_code, status);
      return {
        schema_version: 1,
        command: requiredString(payload.command, "payload.command"),
        status,
        started_at: startedAt,
        completed_at: completedAt,
        exit_code: exitCode,
        ...(optionalString(payload.summary) === null
          ? {}
          : { summary: optionalString(payload.summary) }),
        ...(payload.log_artifact_ref === undefined
          ? {}
          : { log_artifact_ref: normalizeNullableString(payload.log_artifact_ref, "payload.log_artifact_ref") })
      };
    }
    case "artifact":
      assertAllowedKeys(payload, [
        "schema_version",
        "artifact_type",
        "name",
        "uri",
        "content_hash",
        "created_at",
        "description"
      ]);
      return {
        schema_version: 1,
        artifact_type: requiredString(payload.artifact_type, "payload.artifact_type"),
        name: requiredString(payload.name, "payload.name"),
        uri: requiredString(payload.uri, "payload.uri"),
        content_hash: requiredString(payload.content_hash, "payload.content_hash"),
        created_at: requiredTimestamp(payload.created_at, "payload.created_at"),
        ...(optionalString(payload.description) === null
          ? {}
          : { description: optionalString(payload.description) })
      };
  }
}

function assertSchemaVersion(payload: Record<string, unknown>) {
  if (payload.schema_version !== 1) {
    throw validationError("payload.schema_version must be 1.");
  }
}

function assertAllowedKeys(
  payload: Record<string, unknown>,
  allowedKeys: string[]
) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw validationError(`payload.${key} is not allowed.`);
    }
  }
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError(`${field} must be a non-empty string.`);
  }
  assertUnicode(value);
  return value;
}

function optionalString(value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw validationError("Optional payload text must be a string.");
  }
  assertUnicode(value);
  return value;
}

function normalizeNullableString(value: unknown, field: string) {
  if (value === null) {
    return null;
  }
  return requiredString(value, field);
}

function requiredEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: T[]
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw validationError(`${field} is invalid.`);
  }
  return value as T;
}

function requiredTimestamp(value: unknown, field: string) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw validationError(`${field} must be UTC millisecond timestamp.`);
  }
  return value;
}

function normalizeChangedFiles(value: unknown) {
  const files = [...new Set(stringArray(value, "payload.changed_files"))];
  for (const file of files) {
    if (
      file.startsWith("/") ||
      file.includes("\\") ||
      file.split("/").includes("..")
    ) {
      throw validationError("payload.changed_files must be repository-relative POSIX paths.");
    }
  }
  return files.sort(compareCodePoints);
}

function normalizeExitCode(value: unknown, status: string) {
  if (value !== null && (!Number.isInteger(value))) {
    throw validationError("payload.exit_code must be an integer or null.");
  }
  if (status === "passed" && value !== 0) {
    throw validationError("payload.exit_code must be 0 when status is passed.");
  }
  if (status === "failed" && (value === null || value === 0)) {
    throw validationError("payload.exit_code must be non-zero when status is failed.");
  }
  return value;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw validationError(`${field} must be an array.`);
  return value.map(item => requiredString(item, field));
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

// changed_files 使用 code point 排序；JCS object keys 則維持 UTF-16 排序。
function compareCodePoints(left: string, right: string) {
  const leftPoints = Array.from(left, character => character.codePointAt(0)!);
  const rightPoints = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0;index < Math.min(leftPoints.length, rightPoints.length);index++) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}
