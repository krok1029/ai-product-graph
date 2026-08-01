import { ApplicationError } from "../domain/errors.js";
import type {
  AuditLogEntry,
  GraphDraftBatch,
  GraphDraftBatchChange,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphRelationType,
  GraphRevision,
  LifecycleStatus
} from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

const PRODUCT_INTENT_NODE_TYPES = new Set<GraphNodeType>([
  "product_goal",
  "persona",
  "pain_point",
  "workflow",
  "feature_area"
]);

const GRAPH_RELATION_TYPES = new Set<GraphRelationType>([
  "clarifies",
  "supports",
  "solves",
  "belongs_to",
  "depends_on",
  "implements",
  "validated_by",
  "changed_by",
  "traces_to",
  "blocked_by",
  "supersedes",
  "waives"
]);

export type GraphChangeInput = {
  changeId: string;
  operation: "add" | "update" | "archive";
  entityKind: "node" | "edge";
  targetId: string | null;
  payload: Record<string, unknown>;
};

type GraphWorkflowOptions = {
  idFactory: () => string;
  clock: () => Date;
  actor: {
    id: string;
    displayName: string;
  };
};

export class GraphWorkflow {
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly options: GraphWorkflowOptions
  ) {}

  createDraft(input: {
    projectId: string;
    baseGraphRevisionId: string | null;
    sourceProductBriefVersionId: string;
    reconciliationSummary?: string;
    changes: GraphChangeInput[];
  }) {
    const summary = normalizeOptionalText(input.reconciliationSummary);
    if (!Array.isArray(input.changes)) {
      throw validationError("Graph changes must be an array.");
    }
    if (input.changes.length === 0 && !summary) {
      throw validationError(
        "A no-op Graph Draft Batch requires reconciliation_summary."
      );
    }
    const now = this.options.clock().toISOString();

    return this.ports.transactions.run(() => {
      const project = this.requireActiveProject(input.projectId);
      if (input.baseGraphRevisionId !== project.currentGraphRevisionId) {
        throw graphBaseConflict(
          input.baseGraphRevisionId,
          project.currentGraphRevisionId
        );
      }
      const productBrief = this.ports.productBriefs.findByProjectId(project.id);
      if (
        !productBrief ||
        productBrief.currentApprovedVersionId !==
          input.sourceProductBriefVersionId
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Graph source is not the current approved Product Brief Version.",
          {
            sourceProductBriefVersionId:
              input.sourceProductBriefVersionId,
            currentProductBriefVersionId:
              productBrief?.currentApprovedVersionId ?? null
          }
        );
      }
      const sourceVersion = this.ports.productBriefVersions.findById(
        input.sourceProductBriefVersionId
      );
      if (
        !sourceVersion ||
        sourceVersion.projectId !== project.id ||
        sourceVersion.reviewStatus !== "approved" ||
        sourceVersion.lifecycleStatus !== "active"
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Graph source Product Brief Version is not active and approved.",
          { sourceProductBriefVersionId: input.sourceProductBriefVersionId }
        );
      }

      const batchId = this.options.idFactory();
      const validation = this.validateChanges(
        project.id,
        batchId,
        input.changes,
        now
      );
      const batch: GraphDraftBatch = {
        id: batchId,
        projectId: project.id,
        sourceProductBriefVersionId: sourceVersion.id,
        baseGraphRevisionId: project.currentGraphRevisionId,
        reconciliationSummary: summary,
        reviewStatus: "draft",
        lifecycleStatus: "active",
        approvedByActorId: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now
      };
      const audit = this.newAuditEntry({
        projectId: project.id,
        action: "graph_draft_batch.created",
        entityType: "graph_draft_batch",
        entityId: batch.id,
        afterSummary: {
          batch,
          changeCount: validation.changes.length,
          conflicts: validation.conflicts
        },
        createdAt: now
      });

      this.ports.graphDraftBatches.insert(batch, validation.changes);
      this.ports.auditLog.append(audit);

      return {
        graphDraftBatch: batch,
        changeCount: validation.changes.length,
        isNoopReconciliation: validation.changes.length === 0,
        validation: {
          warnings: [] as string[],
          conflicts: validation.conflicts
        },
        auditLogId: audit.id
      };
    });
  }

  approve(graphDraftBatchId: string) {
    const now = this.options.clock().toISOString();

    return this.ports.transactions.run(() => {
      const batch = this.ports.graphDraftBatches.findById(graphDraftBatchId);
      if (!batch) {
        throw new ApplicationError(
          "NOT_FOUND",
          "Graph Draft Batch was not found.",
          { graphDraftBatchId }
        );
      }
      const project = this.requireActiveProject(batch.projectId);
      if (batch.baseGraphRevisionId !== project.currentGraphRevisionId) {
        throw graphBaseConflict(
          batch.baseGraphRevisionId,
          project.currentGraphRevisionId
        );
      }
      const productBrief = this.ports.productBriefs.findByProjectId(project.id);
      if (
        !productBrief ||
        productBrief.currentApprovedVersionId !==
          batch.sourceProductBriefVersionId
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Graph Draft Batch source is no longer the current Product Brief Version.",
          {
            sourceProductBriefVersionId:
              batch.sourceProductBriefVersionId,
            currentProductBriefVersionId:
              productBrief?.currentApprovedVersionId ?? null
          }
        );
      }
      if (
        batch.reviewStatus !== "draft" ||
        batch.lifecycleStatus !== "active"
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Graph Draft Batch is not an active draft.",
          {
            graphDraftBatchId,
            reviewStatus: batch.reviewStatus,
            lifecycleStatus: batch.lifecycleStatus
          }
        );
      }

      const storedChanges =
        this.ports.graphDraftBatches.listChanges(batch.id);
      const storedConflicts = storedChanges
        .filter(change => change.conflict)
        .map(change => ({
          change_id: change.changeId,
          ...change.conflict
        }));
      if (storedConflicts.length > 0) {
        throw new ApplicationError(
          "CONFLICT",
          "Graph Draft Batch has unresolved conflicts.",
          { conflicts: storedConflicts }
        );
      }
      const validation = this.validateChanges(
        project.id,
        batch.id,
        storedChanges.map(change => ({
          changeId: change.changeId,
          operation: change.operation,
          entityKind: change.entityKind,
          targetId: change.targetId,
          payload: change.payload
        })),
        batch.createdAt
      );
      if (validation.conflicts.length > 0) {
        throw new ApplicationError(
          "CONFLICT",
          "Graph Draft Batch has unresolved conflicts.",
          { conflicts: validation.conflicts }
        );
      }

      const revision: GraphRevision = {
        id: this.options.idFactory(),
        projectId: project.id,
        graphDraftBatchId: batch.id,
        sourceProductBriefVersionId: batch.sourceProductBriefVersionId,
        sequenceNumber:
          this.ports.graphRevisions.nextSequenceNumber(project.id),
        isNoopReconciliation: validation.changes.length === 0,
        reconciliationSummary: batch.reconciliationSummary,
        createdAt: now
      };
      this.ports.localActors.ensure({
        id: this.options.actor.id,
        displayName: this.options.actor.displayName,
        createdAt: now,
        updatedAt: now
      });
      this.ports.graphRevisions.insert(revision);
      const advanced = this.ports.projects.advanceGraphRevision(
        project.id,
        batch.baseGraphRevisionId,
        revision.id,
        batch.sourceProductBriefVersionId,
        now
      );
      if (!advanced) {
        const current =
          this.ports.projects.findById(project.id)?.currentGraphRevisionId ??
          null;
        throw graphBaseConflict(batch.baseGraphRevisionId, current);
      }

      const applied = this.applyChanges(
        batch,
        revision,
        validation.changes,
        now
      );
      this.ports.graphDraftBatches.approve(
        batch.id,
        this.options.actor.id,
        now
      );
      const archivedStaleBatchIds =
        this.ports.graphDraftBatches.archiveStaleDrafts(
          project.id,
          batch.id,
          revision.id,
          now
        );
      const approvedBatch: GraphDraftBatch = {
        ...batch,
        reviewStatus: "approved",
        approvedByActorId: this.options.actor.id,
        approvedAt: now,
        updatedAt: now
      };
      const audit = this.newAuditEntry({
        projectId: project.id,
        action: "graph_draft_batch.approved",
        entityType: "graph_draft_batch",
        entityId: batch.id,
        actorId: this.options.actor.id,
        afterSummary: {
          batch: approvedBatch,
          revision,
          applied,
          archivedStaleBatchIds
        },
        createdAt: now
      });
      this.ports.auditLog.append(audit);

      return {
        graphDraftBatch: approvedBatch,
        graphRevision: revision,
        applied: {
          ...applied,
          isNoopReconciliation: revision.isNoopReconciliation,
          reconciliationSummary: revision.reconciliationSummary
        },
        archivedStaleBatchIds,
        productIntentReconciliation: {
          status: "current" as const,
          currentProductBriefVersionId:
            batch.sourceProductBriefVersionId,
          lastReconciledProductBriefVersionId:
            batch.sourceProductBriefVersionId,
          productIntentGraphRevisionId: revision.id
        },
        auditLogId: audit.id
      };
    });
  }

  getContext(input: {
    projectId: string;
    lifecycleStatus?: LifecycleStatus;
    nodeTypes?: GraphNodeType[];
    maxDepth?: number;
  }) {
    const project = this.requireActiveProject(input.projectId);
    const lifecycleStatus = input.lifecycleStatus ?? "active";
    const allNodes = this.ports.graphNodes.list(project.id, lifecycleStatus);
    const allEdges = this.ports.graphEdges.list(project.id, lifecycleStatus);
    const nodeIds =
      input.nodeTypes && input.nodeTypes.length > 0
        ? expandGraphNodeIds(
            allNodes,
            allEdges,
            input.nodeTypes,
            input.maxDepth ?? 2
          )
        : new Set(allNodes.map(node => node.id));
    const nodes = allNodes.filter(node => nodeIds.has(node.id));
    const edges = allEdges.filter(
      edge =>
        nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
    );
    return {
      graphRevisionId: project.currentGraphRevisionId,
      nodes,
      edges
    };
  }

  private validateChanges(
    projectId: string,
    batchId: string,
    inputs: GraphChangeInput[],
    createdAt: string
  ) {
    const changeIds = new Set<string>();
    for (const input of inputs) {
      if (!input.changeId?.trim()) {
        throw validationError("Each graph change requires change_id.");
      }
      if (changeIds.has(input.changeId)) {
        throw validationError(
          `Graph change_id '${input.changeId}' is duplicated.`
        );
      }
      changeIds.add(input.changeId);
      if (!["add", "update", "archive"].includes(input.operation)) {
        throw validationError(
          `Unsupported graph operation '${input.operation}'.`
        );
      }
      if (!["node", "edge"].includes(input.entityKind)) {
        throw validationError(
          `Unsupported graph entity_kind '${input.entityKind}'.`
        );
      }
      if (input.operation === "add" && input.targetId !== null) {
        throw validationError("Add graph changes require target_id = null.");
      }
      if (input.operation !== "add" && !input.targetId) {
        throw validationError(
          "Update and archive graph changes require target_id."
        );
      }
      if (!isRecord(input.payload)) {
        throw validationError("Graph change payload must be an object.");
      }
    }

    const nodeAdds = new Map<string, GraphChangeInput>();
    for (const input of inputs) {
      if (input.entityKind === "node" && input.operation === "add") {
        nodeAdds.set(input.changeId, input);
      }
    }
    const archivedNodeIds = new Set(
      inputs
        .filter(
          input =>
            input.entityKind === "node" &&
            input.operation === "archive" &&
            input.targetId
        )
        .map(input => input.targetId as string)
    );
    const archivedEdgeIds = new Set(
      inputs
        .filter(
          input =>
            input.entityKind === "edge" &&
            input.operation === "archive" &&
            input.targetId
        )
        .map(input => input.targetId as string)
    );
    const batchSlugs = new Set<string>();
    const batchEdgeKeys = new Set<string>();
    const activeEdges = this.ports.graphEdges.list(projectId, "active");

    const changes: GraphDraftBatchChange[] = inputs.map(input => {
      let normalizedPayload: Record<string, unknown>;
      let conflict: Record<string, unknown> | null = null;

      if (input.entityKind === "node") {
        normalizedPayload = normalizeNodePayload(input);
        if (input.operation === "add") {
          const slug = slugify(String(normalizedPayload.title));
          if (
            !slug ||
            batchSlugs.has(slug) ||
            this.ports.graphNodes.findBySlug(projectId, slug)
          ) {
            conflict = graphConflict(
              "AMBIGUOUS_NODE_IDENTITY",
              "A graph node with the same generated slug already exists.",
              { slug }
            );
          }
          batchSlugs.add(slug);
        } else {
          const node = this.ports.graphNodes.findById(input.targetId as string);
          if (
            !node ||
            node.projectId !== projectId ||
            node.lifecycleStatus !== "active"
          ) {
            conflict = graphConflict(
              "NODE_NOT_ACTIVE",
              "Target GraphNode is not active in this Project.",
              { targetId: input.targetId }
            );
          } else if (!PRODUCT_INTENT_NODE_TYPES.has(node.type)) {
            conflict = graphConflict(
              "OWNERSHIP_SCOPE",
              "Product Brief extraction cannot modify this GraphNode type.",
              { targetId: node.id, nodeType: node.type }
            );
          } else if (input.operation === "archive") {
            const unhandledEdges = activeEdges
              .filter(
                edge =>
                  edge.sourceNodeId === node.id ||
                  edge.targetNodeId === node.id
              )
              .filter(edge => !archivedEdgeIds.has(edge.id))
              .map(edge => edge.id);
            if (unhandledEdges.length > 0) {
              conflict = graphConflict(
                "ACTIVE_EDGE_REMAINS",
                "Archiving a node requires archiving its active edges.",
                { targetId: node.id, activeEdgeIds: unhandledEdges }
              );
            }
          }
        }
      } else {
        normalizedPayload = normalizeEdgePayload(input);
        if (input.operation === "add") {
          const source = validateEndpoint(
            normalizedPayload,
            "source",
            projectId,
            nodeAdds,
            archivedNodeIds,
            this.ports
          );
          const target = validateEndpoint(
            normalizedPayload,
            "target",
            projectId,
            nodeAdds,
            archivedNodeIds,
            this.ports
          );
          conflict = source.conflict ?? target.conflict;
          const key = `${source.key}|${target.key}|${String(
            normalizedPayload.relation_type
          )}`;
          if (!conflict && batchEdgeKeys.has(key)) {
            conflict = graphConflict(
              "DUPLICATE_EDGE",
              "The Graph Draft Batch contains a duplicate edge.",
              { key }
            );
          }
          batchEdgeKeys.add(key);
          if (
            !conflict &&
            source.nodeId &&
            target.nodeId &&
            activeEdges.some(
              edge =>
                edge.sourceNodeId === source.nodeId &&
                edge.targetNodeId === target.nodeId &&
                edge.relationType === normalizedPayload.relation_type
            )
          ) {
            conflict = graphConflict(
              "DUPLICATE_EDGE",
              "An equivalent active GraphEdge already exists.",
              { key }
            );
          }
        } else {
          const edge = this.ports.graphEdges.findById(input.targetId as string);
          if (
            !edge ||
            edge.projectId !== projectId ||
            edge.lifecycleStatus !== "active"
          ) {
            conflict = graphConflict(
              "EDGE_NOT_ACTIVE",
              "Target GraphEdge is not active in this Project.",
              { targetId: input.targetId }
            );
          } else {
            const source = this.ports.graphNodes.findById(edge.sourceNodeId);
            const target = this.ports.graphNodes.findById(edge.targetNodeId);
            if (
              !source ||
              !target ||
              !PRODUCT_INTENT_NODE_TYPES.has(source.type) ||
              !PRODUCT_INTENT_NODE_TYPES.has(target.type)
            ) {
              conflict = graphConflict(
                "OWNERSHIP_SCOPE",
                "Product Brief extraction cannot modify this GraphEdge.",
                { targetId: edge.id }
              );
            }
          }
        }
      }

      return {
        id: this.options.idFactory(),
        graphDraftBatchId: batchId,
        projectId,
        changeId: input.changeId,
        operation: input.operation,
        entityKind: input.entityKind,
        targetId: input.targetId,
        payload: normalizedPayload,
        conflict,
        createdAt
      };
    });

    return {
      changes,
      conflicts: changes
        .filter(change => change.conflict)
        .map(change => ({
          change_id: change.changeId,
          ...change.conflict
        }))
    };
  }

  private applyChanges(
    batch: GraphDraftBatch,
    revision: GraphRevision,
    changes: GraphDraftBatchChange[],
    now: string
  ) {
    const addedIds: string[] = [];
    const updatedIds: string[] = [];
    const archivedIds: string[] = [];
    const addedNodeIds = new Map<string, string>();

    for (const change of changes) {
      if (change.entityKind !== "node") continue;
      if (change.operation === "add") {
        const id = this.options.idFactory();
        const title = String(change.payload.title);
        const node: GraphNode = {
          id,
          projectId: batch.projectId,
          slug: slugify(title),
          type: change.payload.type as GraphNodeType,
          title,
          description:
            change.payload.description === null
              ? null
              : String(change.payload.description),
          source: "product_brief",
          sourceRefType: "product_brief_version",
          sourceRefId: batch.sourceProductBriefVersionId,
          lifecycleStatus: "active",
          createdInGraphRevisionId: revision.id,
          lastChangedInGraphRevisionId: revision.id,
          metadata: change.payload.metadata as Record<string, unknown>,
          createdAt: now,
          updatedAt: now
        };
        this.ports.graphNodes.insert(node);
        addedNodeIds.set(change.changeId, node.id);
        addedIds.push(node.id);
      } else if (change.operation === "update") {
        this.ports.graphNodes.update(change.targetId as string, {
          ...(change.payload.title !== undefined
            ? { title: change.payload.title as string }
            : {}),
          ...(change.payload.description !== undefined
            ? {
                description: change.payload.description as string | null
              }
            : {}),
          ...(change.payload.metadata !== undefined
            ? {
                metadata: change.payload.metadata as Record<string, unknown>
              }
            : {}),
          sourceRefId: batch.sourceProductBriefVersionId,
          graphRevisionId: revision.id,
          updatedAt: now
        });
        updatedIds.push(change.targetId as string);
      } else {
        this.ports.graphNodes.archive(
          change.targetId as string,
          revision.id,
          now
        );
        archivedIds.push(change.targetId as string);
      }
    }

    for (const change of changes) {
      if (change.entityKind !== "edge") continue;
      if (change.operation === "add") {
        const id = this.options.idFactory();
        const edge: GraphEdge = {
          id,
          projectId: batch.projectId,
          sourceNodeId: resolveEndpointId(
            change.payload,
            "source",
            addedNodeIds
          ),
          targetNodeId: resolveEndpointId(
            change.payload,
            "target",
            addedNodeIds
          ),
          relationType:
            change.payload.relation_type as GraphRelationType,
          confidence: change.payload.confidence as number | null,
          lifecycleStatus: "active",
          createdInGraphRevisionId: revision.id,
          lastChangedInGraphRevisionId: revision.id,
          metadata: change.payload.metadata as Record<string, unknown>,
          createdAt: now,
          updatedAt: now
        };
        this.ports.graphEdges.insert(edge);
        addedIds.push(edge.id);
      } else if (change.operation === "update") {
        this.ports.graphEdges.update(change.targetId as string, {
          ...(change.payload.relation_type !== undefined
            ? {
                relationType:
                  change.payload.relation_type as GraphRelationType
              }
            : {}),
          ...(change.payload.confidence !== undefined
            ? {
                confidence: change.payload.confidence as number | null
              }
            : {}),
          ...(change.payload.metadata !== undefined
            ? {
                metadata: change.payload.metadata as Record<string, unknown>
              }
            : {}),
          graphRevisionId: revision.id,
          updatedAt: now
        });
        updatedIds.push(change.targetId as string);
      } else {
        this.ports.graphEdges.archive(
          change.targetId as string,
          revision.id,
          now
        );
        archivedIds.push(change.targetId as string);
      }
    }

    return { addedIds, updatedIds, archivedIds };
  }

  private requireActiveProject(projectId: string) {
    const project = this.ports.projects.findById(projectId);
    if (!project) {
      throw new ApplicationError("NOT_FOUND", "Project was not found.", {
        projectId
      });
    }
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError("CONFLICT", "Project is archived.", {
        projectId
      });
    }
    return project;
  }

  private newAuditEntry(input: {
    projectId: string;
    action: string;
    entityType: string;
    entityId: string;
    afterSummary: Record<string, unknown>;
    createdAt: string;
    actorId?: string;
  }): AuditLogEntry {
    return {
      id: this.options.idFactory(),
      projectId: input.projectId,
      actorType: "mcp_client",
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeSummary: null,
      afterSummary: input.afterSummary,
      metadata: {},
      createdAt: input.createdAt
    };
  }
}

function normalizeNodePayload(input: GraphChangeInput) {
  assertAllowedKeys(
    input.payload,
    input.operation === "add"
      ? ["type", "title", "description", "metadata"]
      : input.operation === "update"
        ? ["title", "description", "metadata"]
        : []
  );
  if (input.operation === "archive") return {};
  if (input.operation === "add") {
    const type = requireString(input.payload.type, "node payload.type");
    if (!PRODUCT_INTENT_NODE_TYPES.has(type as GraphNodeType)) {
      throw validationError(
        `GraphNode type '${type}' is outside Product Brief ownership.`
      );
    }
    return {
      type,
      title: requireNonEmptyString(
        input.payload.title,
        "node payload.title"
      ),
      description: optionalNullableString(
        input.payload.description,
        "node payload.description"
      ),
      metadata: optionalRecord(input.payload.metadata, "node payload.metadata")
    };
  }
  if (Object.keys(input.payload).length === 0) {
    throw validationError("A node update requires at least one field.");
  }
  return {
    ...(input.payload.title !== undefined
      ? {
          title: requireNonEmptyString(
            input.payload.title,
            "node payload.title"
          )
        }
      : {}),
    ...(input.payload.description !== undefined
      ? {
          description: optionalNullableString(
            input.payload.description,
            "node payload.description"
          )
        }
      : {}),
    ...(input.payload.metadata !== undefined
      ? {
          metadata: optionalRecord(
            input.payload.metadata,
            "node payload.metadata"
          )
        }
      : {})
  };
}

function normalizeEdgePayload(input: GraphChangeInput) {
  assertAllowedKeys(
    input.payload,
    input.operation === "add"
      ? [
          "source_node_id",
          "source_change_id",
          "target_node_id",
          "target_change_id",
          "relation_type",
          "confidence",
          "metadata"
        ]
      : input.operation === "update"
        ? ["relation_type", "confidence", "metadata"]
        : []
  );
  if (input.operation === "archive") return {};
  const relation =
    input.payload.relation_type === undefined
      ? undefined
      : requireString(
          input.payload.relation_type,
          "edge payload.relation_type"
        );
  if (relation !== undefined && !GRAPH_RELATION_TYPES.has(
    relation as GraphRelationType
  )) {
    throw validationError(`Unsupported GraphEdge relation '${relation}'.`);
  }
  const confidence = optionalConfidence(input.payload.confidence);
  const metadata = optionalRecord(
    input.payload.metadata,
    "edge payload.metadata"
  );
  if (input.operation === "update") {
    if (Object.keys(input.payload).length === 0) {
      throw validationError("An edge update requires at least one field.");
    }
    return {
      ...(relation !== undefined ? { relation_type: relation } : {}),
      ...(input.payload.confidence !== undefined ? { confidence } : {}),
      ...(input.payload.metadata !== undefined ? { metadata } : {})
    };
  }
  const source = normalizeEndpoint(input.payload, "source");
  const target = normalizeEndpoint(input.payload, "target");
  if (!relation) {
    throw validationError("Edge add requires relation_type.");
  }
  return {
    ...source,
    ...target,
    relation_type: relation,
    confidence,
    metadata
  };
}

function normalizeEndpoint(
  payload: Record<string, unknown>,
  prefix: "source" | "target"
) {
  const nodeKey = `${prefix}_node_id`;
  const changeKey = `${prefix}_change_id`;
  const nodeId = payload[nodeKey];
  const changeId = payload[changeKey];
  if ((nodeId === undefined) === (changeId === undefined)) {
    throw validationError(
      `Edge ${prefix} requires exactly one of ${nodeKey} or ${changeKey}.`
    );
  }
  return nodeId !== undefined
    ? { [nodeKey]: requireNonEmptyString(nodeId, nodeKey) }
    : { [changeKey]: requireNonEmptyString(changeId, changeKey) };
}

function validateEndpoint(
  payload: Record<string, unknown>,
  prefix: "source" | "target",
  projectId: string,
  nodeAdds: Map<string, GraphChangeInput>,
  archivedNodeIds: Set<string>,
  ports: ApplicationPorts
) {
  const nodeId = payload[`${prefix}_node_id`];
  if (typeof nodeId === "string") {
    const node = ports.graphNodes.findById(nodeId);
    if (
      !node ||
      node.projectId !== projectId ||
      node.lifecycleStatus !== "active" ||
      archivedNodeIds.has(node.id)
    ) {
      return {
        key: `node:${nodeId}`,
        nodeId,
        conflict: graphConflict(
          "EDGE_ENDPOINT_NOT_ACTIVE",
          `GraphEdge ${prefix} endpoint is not active in this Project.`,
          { nodeId }
        )
      };
    }
    if (!PRODUCT_INTENT_NODE_TYPES.has(node.type)) {
      return {
        key: `node:${nodeId}`,
        nodeId,
        conflict: graphConflict(
          "OWNERSHIP_SCOPE",
          "Product Brief extraction cannot connect this GraphNode type.",
          { nodeId, nodeType: node.type }
        )
      };
    }
    return { key: `node:${nodeId}`, nodeId, conflict: null };
  }
  const changeId = String(payload[`${prefix}_change_id`]);
  const change = nodeAdds.get(changeId);
  if (!change) {
    return {
      key: `change:${changeId}`,
      nodeId: null,
      conflict: graphConflict(
        "EDGE_ENDPOINT_CHANGE_NOT_FOUND",
        `GraphEdge ${prefix} change reference is not a node add.`,
        { changeId }
      )
    };
  }
  return { key: `change:${changeId}`, nodeId: null, conflict: null };
}

function resolveEndpointId(
  payload: Record<string, unknown>,
  prefix: "source" | "target",
  addedNodeIds: Map<string, string>
): string {
  const nodeId = payload[`${prefix}_node_id`];
  if (typeof nodeId === "string") return nodeId;
  const changeId = String(payload[`${prefix}_change_id`]);
  const resolved = addedNodeIds.get(changeId);
  if (!resolved) {
    throw new ApplicationError(
      "INTERNAL_ERROR",
      "Validated GraphEdge endpoint could not be resolved.",
      { prefix, changeId }
    );
  }
  return resolved;
}

function expandGraphNodeIds(
  nodes: GraphNode[],
  edges: GraphEdge[],
  seedTypes: GraphNodeType[],
  maxDepth: number
): Set<string> {
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 10) {
    throw validationError("max_depth must be an integer between 0 and 10.");
  }
  const selected = new Set(
    nodes.filter(node => seedTypes.includes(node.type)).map(node => node.id)
  );
  let frontier = new Set(selected);

  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.sourceNodeId)) {
        next.add(edge.targetNodeId);
      }
      if (frontier.has(edge.targetNodeId)) {
        next.add(edge.sourceNodeId);
      }
    }
    const unvisited = [...next].filter(nodeId => !selected.has(nodeId));
    for (const nodeId of unvisited) {
      selected.add(nodeId);
    }
    frontier = new Set(unvisited);
  }
  return selected;
}

function graphBaseConflict(
  expectedGraphRevisionId: string | null,
  currentGraphRevisionId: string | null
) {
  return new ApplicationError(
    "CONFLICT",
    "Graph Draft Batch base revision is no longer current.",
    { expectedGraphRevisionId, currentGraphRevisionId }
  );
}

function graphConflict(
  code: string,
  message: string,
  details: Record<string, unknown>
) {
  return { code, message, details };
}

function validationError(message: string) {
  return new ApplicationError("VALIDATION_ERROR", message);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[]
) {
  const extras = Object.keys(value).filter(key => !allowed.includes(key));
  if (extras.length > 0) {
    throw validationError(
      `Unsupported graph payload fields: ${extras.join(", ")}.`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalRecord(value: unknown, field: string) {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw validationError(`${field} must be an object.`);
  }
  return value;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw validationError(`${field} must be a string.`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string) {
  const normalized = requireString(value, field).trim();
  if (!normalized) {
    throw validationError(`${field} must not be empty.`);
  }
  return normalized;
}

function optionalNullableString(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  return requireString(value, field).trim() || null;
}

function optionalConfidence(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw validationError("edge payload.confidence must be between 0 and 1.");
  }
  return value;
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
