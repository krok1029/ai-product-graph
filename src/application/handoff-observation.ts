// Handoff 嘗試的觀測紀錄與來源驗證；不改寫交付狀態或 approved artifacts。
import { ApplicationError } from "../domain/errors.js";
import type { ImplementationBrief } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import { requireHandoffSource } from "./handoff-source-validation.js";
import { evaluateImplementationFreshness } from "./implementation-freshness.js";
import { staleHandoff } from "./implementation-workflow-helpers.js";

type HandoffInput = {
  implementationBriefId: string;
  currentRepositoryState: { commitSha: string; dirtyStateFingerprint?: string | null };
};
type ObservationOptions = {
  idFactory: () => string;
  clock: () => Date;
  actor: { id: string; displayName: string };
};

export function getObservedImplementationHandoff(
  ports: ApplicationPorts, options: ObservationOptions, input: HandoffInput
) {
  const brief = ports.implementationBriefs.findById(
    input.implementationBriefId
  );
  if (!brief) {
    throw new ApplicationError(
      "NOT_FOUND",
      "Implementation Brief was not found.",
      { implementationBriefId: input.implementationBriefId }
    );
  }
  const observedBrief = brief;
  const now = options.clock().toISOString();
  let handoff: ReturnType<typeof validateHandoff>;
  try {
    handoff = validateHandoff(ports, brief, input);
  } catch (error) {
    if (!(error instanceof ApplicationError) || error.code !== "STALE_HANDOFF") throw error;
    // 先提交觀測 transaction 再拋 stale，避免 error 使 audit 一起 rollback。
    recordAttempt("stale", safeDetails(error.details));
    throw error;
  }
  recordAttempt("current", {});
  return handoff;

  function recordAttempt(freshness: "current" | "stale", details: Record<string, unknown>) {
    ports.transactions.run(() => {
      ports.localActors.ensure({ ...options.actor, createdAt: now, updatedAt: now });
      ports.auditLog.append({
        id: options.idFactory(), projectId: observedBrief.projectId,
        actorType: "mcp_client", actorId: options.actor.id,
        action: freshness === "current" ? "implementation_handoff.succeeded" : "implementation_handoff.blocked",
        entityType: "implementation_brief", entityId: observedBrief.id,
        beforeSummary: null, afterSummary: { freshness, ...details }, metadata: {}, createdAt: now
      });
    });
  }
}

function validateHandoff(ports: ApplicationPorts, brief: ImplementationBrief, input: HandoffInput) {
  if (brief.lifecycleStatus !== "active") {
    throw staleHandoff("implementation_brief_archived", {
      implementationBriefId: brief.id
    });
  }
  if (brief.reviewStatus !== "approved") {
    throw staleHandoff("implementation_brief_not_approved", {
      implementationBriefId: brief.id
    });
  }
  const source = requireHandoffSource(ports, brief);
  const snapshot = source.snapshot;
  const staleReason = evaluateImplementationFreshness(
    ports,
    source.ticket,
    source.revision,
    snapshot,
    input.currentRepositoryState
  );
  if (staleReason) {
    throw staleHandoff(staleReason.reason, staleReason.details);
  }

  return {
    freshness: "current" as const,
    implementationBrief: brief,
    implementationTarget: source.target,
    ticket: source.ticket,
    ticketRevision: source.revision,
    productBriefVersion: source.productBriefVersion,
    repository: source.repository,
    repositoryContextSnapshot: snapshot
  };
}

function safeDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  // Client 回報的 commit/fingerprint 不存入 audit；保留 server 判定的 reason 與來源 IDs。
  const omitted = new Set(["currentCommitSha", "currentDirtyStateFingerprint", "expectedDirtyStateFingerprint"]);
  return Object.fromEntries(Object.entries(details).filter(([key]) => !omitted.has(key)));
}
