import { describe, expect, it } from "vitest";
import type { SyncAttempt, SyncIntentDetails } from "../domain/sync-intent.js";
import { deriveMappingSyncHealth, type MappingSyncHealthInput } from "./derive-mapping-sync-health.js";
import { hashJson } from "./plane-export-payload.js";

function intent(id: string, sequence: number | null, operation = "update", revision = "revision-2",
  outcomes: SyncAttempt["resultStatus"][] = []): SyncIntentDetails {
  const payload = { schema_version: 1, owner: { type: "ticket", id: "ticket" },
    source_ticket_revision_id: revision,
    ...(operation === "close" || operation === "reopen" ? { delivery_status: operation === "close" ? "done" : "planned" } :
      { specification: { title: "Title", user_story: "Story", scope: ["Scope"],
        acceptance_criteria: [{ id: "AC1", text: "Can export" }], non_goals: [] } }) };
  return { syncIntent: { id, projectId: "project", mappingId: sequence === null ? null : "mapping",
    externalContainerId: "container", sequenceNumber: sequence, operation,
    sourceEventType: sequence === null ? "plane_ticket_export_requested" : "ticket_revision.approved",
    sourceEventId: `event-${id}`, sourceTicketRevisionId: revision, payloadHash: hashJson(payload), payload,
    idempotencyKey: `key-${id}`, supersedesSyncIntentId: null, lifecycleStatus: "active", createdAt: "2026-01-01T00:00:00.000Z" },
    attempts: outcomes.map((resultStatus, index) => ({ id: `${id}-attempt-${index}`, syncIntentId: id,
      externalWorkItemId: resultStatus === "succeeded" ? "item" : null, operation, idempotencyKey: `key-${id}`,
      startedAt: `2026-01-01T00:00:0${index}.000Z`, completedAt: resultStatus === "started" ? null : `2026-01-01T00:00:0${index}.000Z`,
      resultStatus, response: resultStatus === "succeeded" ? { mapping_id: "mapping", snapshot_id: "snapshot" } : null,
      error: resultStatus === "failed" ? { code: "FAILURE" } : null })), requestState: "pending" };
}

function fixture(): MappingSyncHealthInput {
  return { mapping: { id: "mapping", projectId: "project", internalOwnerType: "ticket", internalOwnerId: "ticket",
    externalContainerId: "container", externalWorkItemId: "item", sourceTicketRevisionId: "revision-1",
    lifecycleStatus: "active", nextSequenceNumber: 1, metadata: { created_by_sync_intent_id: "create" },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null },
    ticket: { id: "ticket", currentApprovedRevisionId: "revision-1", deliveryStatus: "planned" },
    createRequest: intent("create", null, "create", "revision-1", ["succeeded"]), intents: [] };
}

const target = (input: MappingSyncHealthInput) => deriveMappingSyncHealth({ ...input,
  mapping: { ...input.mapping, nextSequenceNumber: input.intents.length + 1 } });
describe("deriveMappingSyncHealth", () => {
  it("should report the successful original create as current baseline without mutating input", () => {
    const input = fixture();
    const before = JSON.stringify(input);

    expect(target(input)).toEqual({ syncHealth: "current", included: true, requiredIntentIds: ["create"],
      ignoredContentIntentIds: [], reasons: [{ code: "obligations_fulfilled" }] });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    { outcomes: [], health: "pending" }, { outcomes: ["started"], health: "pending" },
    { outcomes: ["failed"], health: "failed" }, { outcomes: ["failed", "started"], health: "pending" },
    { outcomes: ["failed", "succeeded"], health: "current" }, { outcomes: ["succeeded", "failed"], health: "current" }
  ] as { outcomes: SyncAttempt["resultStatus"][]; health: string }[])(
    "should derive $health from desired update attempts $outcomes", ({ outcomes, health }) => {
      const input = fixture();
      input.ticket.currentApprovedRevisionId = "revision-2";
      input.intents = [intent("update", 1, "update", "revision-2", outcomes)];

      const result = target(input);

      expect(result.syncHealth).toBe(health);
      expect(result.requiredIntentIds).toEqual(["create", "update"]);
    });

  it.each([
    { outcomes: [], pointer: false, health: "pending", ignored: [] },
    { outcomes: [], pointer: true, health: "current", ignored: ["old"] },
    { outcomes: ["started"], pointer: true, health: "pending", ignored: [] },
    { outcomes: ["failed", "started"], pointer: true, health: "pending", ignored: [] },
    { outcomes: ["failed"], pointer: false, health: "current", ignored: ["old"] },
    { outcomes: ["succeeded"], pointer: false, health: "current", ignored: [] }
  ] as { outcomes: SyncAttempt["resultStatus"][]; pointer: boolean; health: string; ignored: string[] }[])(
    "should retain or ignore old content ($outcomes, pointer $pointer)", ({ outcomes, pointer, health, ignored }) => {
      const input = fixture();
      input.ticket.currentApprovedRevisionId = "revision-3";
      const newest = intent("new", 2, "update", "revision-3", ["succeeded"]);
      newest.syncIntent.supersedesSyncIntentId = pointer ? "old" : null;
      input.intents = [intent("old", 1, "update", "revision-2", outcomes), newest];

      const result = target(input);

      expect(result.syncHealth).toBe(health);
      expect(result.ignoredContentIntentIds).toEqual(ignored);
    });

  it("should follow a validated explicit supersession chain", () => {
    const input = fixture();
    input.ticket.currentApprovedRevisionId = "revision-4";
    const middle = intent("middle", 2, "update", "revision-3");
    const newest = intent("new", 3, "update", "revision-4", ["succeeded"]);
    middle.syncIntent.supersedesSyncIntentId = "old";
    newest.syncIntent.supersedesSyncIntentId = "middle";
    input.intents = [intent("old", 1), middle, newest];

    expect(target(input)).toMatchObject({ syncHealth: "current", requiredIntentIds: ["create", "new"],
      ignoredContentIntentIds: ["old", "middle"] });
  });

  it.each(["cross_mapping", "backward", "cycle", "lifecycle_target", "cross_lifecycle"])(
    "should not discharge pending work with an invalid %s supersession", kind => {
      const input = fixture();
      input.ticket.currentApprovedRevisionId = "revision-3";
      const old = intent("old", 1);
      const newest = intent("new", 3, "update", "revision-3", ["succeeded"]);
      newest.syncIntent.supersedesSyncIntentId = "old";
      if (kind === "cross_mapping") old.syncIntent.mappingId = "other";
      if (kind === "backward" || kind === "cycle") old.syncIntent.supersedesSyncIntentId = "new";
      if (kind === "backward") newest.syncIntent.supersedesSyncIntentId = null;
      if (kind === "lifecycle_target") Object.assign(old, intent("old", 1, "close", "revision-2"));
      input.intents = [old, ...(kind === "cross_lifecycle" ? [intent("barrier", 2, "close", "revision-2", ["succeeded"])] : []), newest];

      const result = target(input);

      expect(result.syncHealth).toBe("pending");
      expect(result.ignoredContentIntentIds).toEqual([]);
      expect(result.reasons.some(reason => ["invalid_supersession", "invalid_obligation"].includes(reason.code))).toBe(true);
    });

  it.each([false, true])("should retain failed lifecycle barriers including archived=%s", archived => {
    const input = fixture();
    input.ticket.currentApprovedRevisionId = "revision-2";
    const close = intent("close", 1, "close", "revision-1", ["failed"]);
    if (archived) close.syncIntent.lifecycleStatus = "archived";
    input.intents = [close, intent("reopen", 2, "reopen", "revision-1", ["succeeded"]),
      intent("update", 3, "update", "revision-2", ["succeeded"])];

    expect(target(input)).toMatchObject({ syncHealth: "failed", requiredIntentIds: ["create", "close", "reopen", "update"],
      reasons: [{ code: "intent_failed", intentId: "close" }] });
  });

  it.each(["no_update", "current_revision_close_only"])("should diagnose missing current content for %s", kind => {
    const input = fixture();
    input.ticket.currentApprovedRevisionId = "revision-2";
    if (kind === "current_revision_close_only") {
      input.ticket.deliveryStatus = "done";
      input.intents = [intent("close", 1, "close", "revision-2", ["succeeded"])];
    }

    expect(target(input)).toMatchObject({ syncHealth: "pending", reasons: [{ code: "missing_current_content_intent" }] });
  });

  it.each([
    { status: "done", operations: [], reason: "missing_close_intent" },
    { status: "done", operations: ["close", "reopen"], reason: "missing_close_intent" },
    { status: "planned", operations: ["close"], reason: "missing_reopen_intent" },
    { status: "blocked", operations: ["close"], reason: "missing_reopen_intent" }
  ] as const)("should detect missing desired lifecycle obligation $reason", ({ status, operations, reason }) => {
    const input = fixture();
    input.ticket.deliveryStatus = status;
    input.intents = operations.map((operation, index) => intent(operation, index + 1, operation, "revision-1", ["succeeded"]));

    expect(target(input)).toMatchObject({ syncHealth: "pending", reasons: [{ code: reason }] });
  });

  it("should count a pending latest close and successful reopen as lifecycle obligations", () => {
    const input = fixture();
    input.ticket.deliveryStatus = "done";
    input.intents = [intent("close", 1, "close", "revision-1")];
    expect(target(input)).toMatchObject({ syncHealth: "pending", reasons: [{ code: "intent_pending", intentId: "close" }] });
    input.ticket.deliveryStatus = "planned";
    input.intents = [intent("close", 1, "close", "revision-1", ["succeeded"]), intent("reopen", 2, "reopen", "revision-1", ["succeeded"])];
    expect(target(input).syncHealth).toBe("current");
  });

  it("should explicitly exclude an archived mapping without manufacturing a fourth health state", () => {
    const input = fixture();
    input.mapping.lifecycleStatus = "archived";
    input.intents = [intent("update", 1, "update", "revision-2", ["failed"])];
    expect(target(input)).toEqual({ syncHealth: "current", included: false, requiredIntentIds: [],
      ignoredContentIntentIds: [], reasons: [{ code: "mapping_archived" }] });
  });

  it.each(["missing_create", "missing_proof", "wrong_owner", "unknown_operation", "bad_sequence", "duplicate_sequence",
    "bad_payload", "bad_hash", "wrong_attempt", "wrong_key", "wrong_item", "missing_completion"])(
    "should never report current for invalid history: %s", kind => {
      const input = fixture();
      const update = intent("update", 1, "update", "revision-1", ["succeeded"]);
      input.intents = [update];
      if (kind === "missing_create") input.createRequest = null;
      if (kind === "missing_proof") input.createRequest!.attempts[0]!.response = {};
      if (kind === "wrong_owner") input.ticket.id = "other";
      if (kind === "unknown_operation") update.syncIntent.operation = "other";
      if (kind === "bad_sequence") update.syncIntent.sequenceNumber = -1;
      if (kind === "duplicate_sequence") input.intents.push(intent("duplicate", 1, "update", "revision-1", ["succeeded"]));
      if (kind === "bad_payload") {
        update.syncIntent.payload.specification = {};
        update.syncIntent.payloadHash = hashJson(update.syncIntent.payload);
      }
      if (kind === "bad_hash") update.syncIntent.payloadHash = "bad";
      if (kind === "wrong_attempt") update.attempts[0]!.syncIntentId = "other";
      if (kind === "wrong_key") update.attempts[0]!.idempotencyKey = "other";
      if (kind === "wrong_item") update.attempts[0]!.externalWorkItemId = "other";
      if (kind === "missing_completion") update.attempts[0]!.completedAt = null;

      const result = target(input);

      expect(result.syncHealth).toBe("pending");
      expect(result.reasons.some(reason => ["invalid_obligation", "incomplete_history"].includes(reason.code))).toBe(true);
    });
});
