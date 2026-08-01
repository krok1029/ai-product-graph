// Graph workflow 輔助工具。
//
// GraphWorkflow 使用的純驗證與 normalization helpers。把這些細節拆出來後，
// workflow class 可以專注在 transaction 順序，同時維持 callers 和 tests
// 使用的 graph change contract。

import { ApplicationError } from "../domain/errors.js";
import type {
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphRelationType
} from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import type { GraphChangeInput } from "./graph-workflow.js";

export const PRODUCT_INTENT_NODE_TYPES = new Set<GraphNodeType>([
  "product_goal",
  "persona",
  "pain_point",
  "workflow",
  "feature_area"
]);

export const GRAPH_RELATION_TYPES = new Set<GraphRelationType>([
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

export function normalizeNodePayload(input: GraphChangeInput) {
  assertAllowedKeys(
    input.payload,
    input.operation === "add"
      ? ["type","title","description","metadata"]
      :input.operation === "update"
        ? ["title","description","metadata"]
        :[]
  );
  if (input.operation === "archive") return {};
  if (input.operation === "add") {
    const type = requireString(input.payload.type,"node payload.type");
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
      metadata: optionalRecord(input.payload.metadata,"node payload.metadata")
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
      :{}),
    ...(input.payload.description !== undefined
      ? {
        description: optionalNullableString(
          input.payload.description,
          "node payload.description"
        )
      }
      :{}),
    ...(input.payload.metadata !== undefined
      ? {
        metadata: optionalRecord(
          input.payload.metadata,
          "node payload.metadata"
        )
      }
      :{})
  };
}

export function normalizeEdgePayload(input: GraphChangeInput) {
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
      :input.operation === "update"
        ? ["relation_type","confidence","metadata"]
        :[]
  );
  if (input.operation === "archive") return {};
  const relation = 
    input.payload.relation_type === undefined
      ? undefined
      :requireString(
        input.payload.relation_type,
        "edge payload.relation_type"
      );
  if (relation !== undefined&&!GRAPH_RELATION_TYPES.has(
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
      ...(relation !== undefined? { relation_type: relation }:{}),
      ...(input.payload.confidence !== undefined? { confidence }:{}),
      ...(input.payload.metadata !== undefined? { metadata }:{})
    };
  }
  const source = normalizeEndpoint(input.payload,"source");
  const target = normalizeEndpoint(input.payload,"target");
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
    :{ [changeKey]: requireNonEmptyString(changeId, changeKey) };
}

export function validateEndpoint(
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
      !node||
      node.projectId !== projectId||
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

export function resolveEndpointId(
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

export function expandGraphNodeIds(
  nodes: GraphNode[],
  edges: GraphEdge[],
  seedTypes: GraphNodeType[],
  maxDepth: number
): Set<string> {
  if (!Number.isInteger(maxDepth)||maxDepth<0||maxDepth>10) {
    throw validationError("max_depth must be an integer between 0 and 10.");
  }
  const selected = new Set(
    nodes.filter(node => seedTypes.includes(node.type)).map(node => node.id)
  );
  let frontier = new Set(selected);

  for (let depth = 0;depth<maxDepth&&frontier.size>0;depth+= 1) {
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
    frontier= new Set(unvisited);
  }
  return selected;
}

export function graphBaseConflict(
  expectedGraphRevisionId: string|null,
  currentGraphRevisionId: string|null
) {
  return new ApplicationError(
    "CONFLICT",
    "Graph Draft Batch base revision is no longer current.",
    { expectedGraphRevisionId, currentGraphRevisionId }
  );
}

export function graphConflict(
  code: string,
  message: string,
  details: Record<string, unknown>
) {
  return { code, message, details };
}

export function validationError(message: string) {
  return new ApplicationError("VALIDATION_ERROR", message);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[]
) {
  const extras = Object.keys(value).filter(key => !allowed.includes(key));
  if (extras.length>0) {
    throw validationError(
      `Unsupported graph payload fields: ${extras.join(", ")}.`
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"&&value !== null&&!Array.isArray(value);
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
  if (value === undefined||value === null) return null;
  return requireString(value, field).trim()||null;
}

function optionalConfidence(value: unknown): number|null {
  if (value === undefined||value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)||
    value<0||
    value>1
  ) {
    throw validationError("edge payload.confidence must be between 0 and 1.");
  }
  return value;
}

export function normalizeOptionalText(value: string|undefined): string|null {
  const normalized = value?.trim();
  return normalized? normalized:null;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu,"-")
    .replace(/^-+|-+$/g,"")
    .slice(0,80);
}
