import type {
  ExternalContainer, ExternalContainerIdentity, ExternalContainerProvider
} from "../domain/external-container.js";

export interface ExternalContainerRepository {
  insert(container: ExternalContainer): void;
  findById(id: string): ExternalContainer | null;
  findByIdentity(identity: ExternalContainerIdentity): ExternalContainer | null;
  list(provider?: ExternalContainerProvider): ExternalContainer[];
}
