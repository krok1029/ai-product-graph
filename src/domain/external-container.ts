export type ExternalContainerProvider = "plane";

export type ExternalContainerIdentity = {
  provider: ExternalContainerProvider;
  workspaceIdentity: string;
  containerIdentity: string;
};

export type ExternalContainer = ExternalContainerIdentity & {
  id: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
};
