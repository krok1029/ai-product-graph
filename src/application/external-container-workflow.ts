import { ApplicationError } from "../domain/errors.js";
import type { ExternalContainer, ExternalContainerProvider } from "../domain/external-container.js";
import type { ApplicationPorts } from "./ports.js";

export type RegisterExternalContainerInput = {
  provider: ExternalContainerProvider;
  workspaceIdentity: string;
  containerIdentity: string;
  displayName?: string;
};

type Options = {
  idFactory: () => string;
  clock: () => Date;
  actor: { id: string; displayName: string };
};

export class ExternalContainerWorkflow {
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly options: Options
  ) {}

  register(input: RegisterExternalContainerInput) {
    requirePlane(input.provider);
    const identity = {
      provider: input.provider,
      workspaceIdentity: requiredText(input.workspaceIdentity, "workspace_identity"),
      containerIdentity: requiredText(input.containerIdentity, "container_identity")
    };
    const displayName = input.displayName === undefined
      ? null : requiredText(input.displayName, "display_name");

    return this.ports.transactions.run(() => {
      const existing = this.ports.externalContainers.findByIdentity(identity);
      if (existing) return { externalContainer: existing, created: false };

      const now = this.options.clock().toISOString();
      const externalContainer: ExternalContainer = {
        ...identity, id: this.options.idFactory(), displayName, createdAt: now, updatedAt: now
      };
      const auditLogId = this.options.idFactory();
      this.ports.localActors.ensure({ ...this.options.actor, createdAt: now, updatedAt: now });
      this.ports.externalContainers.insert(externalContainer);
      this.ports.auditLog.append({
        id: auditLogId, projectId: null, actorType: "mcp_client", actorId: this.options.actor.id,
        action: "external_container.registered", entityType: "external_container", entityId: externalContainer.id,
        beforeSummary: null, afterSummary: externalContainer, metadata: {}, createdAt: now
      });
      return { externalContainer, created: true, auditLogId };
    });
  }

  list(provider?: ExternalContainerProvider) {
    if (provider !== undefined) requirePlane(provider);
    return { externalContainers: this.ports.externalContainers.list(provider) };
  }
}

function requirePlane(provider: unknown): asserts provider is ExternalContainerProvider {
  if (provider !== "plane") {
    throw new ApplicationError("VALIDATION_ERROR", "Only the plane provider is supported.");
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApplicationError("VALIDATION_ERROR", `${field} must be non-empty text.`);
  }
  return value.trim();
}
