import { ulid } from "ulid";
import { acceptanceFixture } from "./result-acceptance-fixture.js";
import { createPlaneCreateProcessor } from "../application/create-plane-create-processor.js";
import { hashJson, planeExportPayload } from "../application/plane-export-payload.js";
import type { ExternalWorkItemMapping } from "../domain/external-work-item.js";
import type { SyncIntent } from "../domain/sync-intent.js";

export function mappingTerminationReadFixture() {
  const f = acceptanceFixture();
  return { ...f, exportMapping, mappedIntent, attempt };

  async function exportMapping(containerIdentity = "project") {
    const container = f.service.registerExternalContainer({ provider: "plane", workspaceIdentity: "workspace", containerIdentity }).externalContainer;
    const create = f.service.requestPlaneTicketExport({ ticketId: f.ticket.id, sourceTicketRevisionId: f.revision.id,
      externalContainerId: container.id, idempotencyKey: containerIdentity }).syncIntent;
    await createPlaneCreateProcessor(f.ports, { async create() { return { status: "succeeded", item: {
      externalId: containerIdentity, externalUrl: null, content: { title: "Observed" }, externalStatus: "open", concurrencyToken: "v1"
    } }; }, async reconcile() { throw new Error("Unexpected reconciliation"); } }).process(create.id, "fixture");
    const mapping = f.ports.externalWorkItems.listTicketMappings(f.ticket.id).find(value => value.externalContainerId === container.id)!;
    return { mapping, create };
  }

  function mappedIntent(mapping: ExternalWorkItemMapping, sequenceNumber: number, id = ulid()) {
    const payload = planeExportPayload(f.revision);
    const intent: SyncIntent = { id, projectId: mapping.projectId, mappingId: mapping.id,
      externalContainerId: mapping.externalContainerId, sequenceNumber, operation: "update",
      sourceEventType: "ticket_revision.approved", sourceEventId: "fixture-approval", sourceTicketRevisionId: f.revision.id,
      payloadHash: hashJson(payload), payload, idempotencyKey: id, supersedesSyncIntentId: null,
      lifecycleStatus: "active", createdAt: "2026-09-27T00:00:00.000Z" };
    f.ports.syncIntents.insert(intent);
    f.database.prepare("UPDATE external_work_item_mappings SET next_sequence_number = MAX(next_sequence_number, ?) WHERE id = ?")
      .run(sequenceNumber + 1, mapping.id);
    return intent;
  }

  function attempt(mapping: ExternalWorkItemMapping, intent: SyncIntent, result: "started" | "failed" | "succeeded", id = ulid()) {
    // Mapped processor 尚未交付；fixture 只保存其合法 durable attempt 形狀，不呼叫 provider。
    f.database.prepare(`INSERT INTO sync_attempts (id, sync_intent_id, external_work_item_id, operation, idempotency_key,
      started_at, completed_at, result_status, response_json, error_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, intent.id, mapping.externalWorkItemId, intent.operation, intent.idempotencyKey,
        "2026-09-27T00:00:00.000Z", result === "started" ? null : "2026-09-27T00:00:00.001Z", result,
        JSON.stringify({ raw: [null, "provider reply"] }), result === "failed" ? '{"code":"FAILED","detail":[null,"原文"]}' : null);
  }
}
