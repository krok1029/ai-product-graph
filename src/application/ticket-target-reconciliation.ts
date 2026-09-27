import type { ImplementationTarget, TicketRevision } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

export function reconcileImplementationTargets(ports: ApplicationPorts, idFactory: () => string, revision: TicketRevision, now: string) {
  const activeTargets = ports.implementationTargets.listActiveByTicketId(
    revision.ticketId
  );
  const activeByRepository = new Map(
    activeTargets.map(target => [target.repositoryId, target])
  );
  const requiredRepositories = new Set(
    revision.requiredTargets.map(target => target.repository_id)
  );
  const targets: Array<
    ImplementationTarget & { identityAction: "created" | "reused" }
  > = [];
  const archivedTargetIds: string[] = [];

  for (const required of revision.requiredTargets) {
    const existing = activeByRepository.get(required.repository_id);
    if (existing) {
      targets.push({ ...existing, identityAction: "reused" });
    } else {
      const target: ImplementationTarget = {
        id: idFactory(),
        projectId: revision.projectId,
        ticketId: revision.ticketId,
        repositoryId: required.repository_id,
        lifecycleStatus: "active",
        createdAt: now,
        updatedAt: now
      };
      ports.implementationTargets.insert(target);
      targets.push({ ...target, identityAction: "created" });
    }
  }

  for (const target of activeTargets) {
    if (!requiredRepositories.has(target.repositoryId)) {
      ports.implementationTargets.archive(target.id, now);
      archivedTargetIds.push(target.id);
    }
  }

  return { targets, archivedTargetIds };
}
