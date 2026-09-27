import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeObservedEvidencePayload as normalize } from "./observed-evidence-payload.js";
import type { ObservedEvidenceType } from "../domain/models.js";

const timestamp = "2026-07-28T00:00:00.000Z";
const payloads: Record<ObservedEvidenceType, Record<string, unknown>> = {
  commit: { schema_version: 1, commit_sha: "abc", committed_at: timestamp, changed_files: [] },
  pull_request: { schema_version: 1, provider: "github", external_id: "1", url: "https://example.com/pull/1", title: "Change", status: "open", head_commit_sha: "abc" },
  test_execution: { schema_version: 1, command: "pnpm test", status: "passed", started_at: timestamp, completed_at: timestamp, exit_code: 0 },
  artifact: { schema_version: 1, artifact_type: "file", name: "coverage", uri: "file://coverage.json", content_hash: "sha256:abc", created_at: timestamp }
};

describe("Observed Evidence payload contract", () => {
  it.each(Object.keys(payloads) as ObservedEvidenceType[])("validates the closed %s schema", type => {
    const payload = payloads[type];
    expect(normalize(type, payload).payload).toEqual(payload);
    expect(() => normalize(type, { ...payload, acceptance_claim: true }))
      .toThrow("is not allowed");
    for (const required of Object.keys(payload)) {
      const missing = { ...payload };
      delete missing[required];
      expect(() => normalize(type, missing)).toThrow();
    }
  });

  it("hashes exact JCS bytes after code point sorting without normalizing Unicode", () => {
    const payload = { ...payloads.commit, changed_files: ["😀", "\ue000", "a", "a"], message: "e\u0301\n" };
    const result = normalize("commit", payload);
    const canonical = '{"changed_files":["a","","😀"],"commit_sha":"abc","committed_at":"2026-07-28T00:00:00.000Z","message":"é\\n","schema_version":1}';
    expect(result.canonicalJson).toBe(canonical);
    expect(result.payloadHash).toBe(`sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`);
    expect(normalize("commit", { ...payload, changed_files: ["a", "\ue000", "😀"] }).payloadHash).toBe(result.payloadHash);
    expect(normalize("commit", { ...payload, message: "é\n" }).payloadHash).not.toBe(result.payloadHash);
  });

  it.each(["/absolute", "src/../secret", "src\\file", "\ud800"])("rejects invalid path %j", path => {
    expect(() => normalize("commit", { ...payloads.commit, changed_files: [path] })).toThrow();
  });

  it.each(["2026-02-30T00:00:00.000Z", "2026-07-28T00:00:00Z", "2026-07-28T00:00:00.000+00:00"])("rejects invalid fixed UTC timestamp %s", value => {
    expect(() => normalize("artifact", { ...payloads.artifact, created_at: value })).toThrow("timestamp");
  });

  it.each([
    ["passed", null], ["passed", 1], ["failed", 0], ["failed", null],
    ["errored", 0.5], ["cancelled", Infinity], ["unknown", 0]
  ])("rejects test status %s with exit code %s", (status, exitCode) => {
    expect(() => normalize("test_execution", { ...payloads.test_execution, status, exit_code: exitCode })).toThrow();
  });

  it.each(["errored", "cancelled"])("allows nullable exit code for %s", status => {
    expect(normalize("test_execution", { ...payloads.test_execution, status, exit_code: null }).payload.exit_code).toBeNull();
  });

  it("rejects inverted execution time and invalid optional text", () => {
    expect(() => normalize("test_execution", { ...payloads.test_execution, completed_at: "2026-07-27T00:00:00.000Z" })).toThrow("after started_at");
    expect(() => normalize("artifact", { ...payloads.artifact, description: 5 })).toThrow("must be a string");
    expect(() => normalize("artifact", { ...payloads.artifact, description: "\udfff" })).toThrow("valid Unicode");
    expect(normalize("artifact", { ...payloads.artifact, description: "" }).payload.description).toBe("");
  });
});
