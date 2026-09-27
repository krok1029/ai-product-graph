import type { MappingSyncHealth } from "../domain/sync-health.js";
import { classifyMappingSyncObligations, type MappingSyncHealthInput } from "./mapping-sync-obligations.js";
export type { MappingSyncHealthInput } from "./mapping-sync-obligations.js";

// Health 只投影共用分類，不改寫任何 request state 或歷史 attempts。
export function deriveMappingSyncHealth(input: MappingSyncHealthInput): MappingSyncHealth {
  const classified = classifyMappingSyncObligations(input);
  const result: MappingSyncHealth = { syncHealth: "current", included: classified.included,
    requiredIntentIds: [], ignoredContentIntentIds: [], reasons: [...classified.diagnostics] };
  if (!result.included) {
    result.reasons.push({ code: "mapping_archived" });
    return result;
  }
  if (classified.diagnostics.length > 0) result.syncHealth = "pending";
  for (const { details, disposition, attemptState } of classified.entries) {
    const intentId = details.syncIntent.id;
    if (disposition === "superseded_unstarted" || disposition === "obsolete_failed_content") {
      result.ignoredContentIntentIds.push(intentId);
      result.reasons.push({ code: disposition === "superseded_unstarted" ? "superseded_unstarted_content" : disposition, intentId });
      continue;
    }
    result.requiredIntentIds.push(intentId);
    if (attemptState === "failed") {
      result.syncHealth = "failed";
      result.reasons.push({ code: "intent_failed", intentId });
    } else if (attemptState !== "succeeded") {
      if (result.syncHealth !== "failed") result.syncHealth = "pending";
      result.reasons.push({ code: "intent_pending", intentId });
    }
  }
  if (result.reasons.length === 0) result.reasons.push({ code: "obligations_fulfilled" });
  return result;
}
